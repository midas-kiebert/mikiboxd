import asyncio
import random
from datetime import datetime

import aiohttp

from app.api.deps import get_db_context
from app.crud import movie as movies_crud
from app.models.movie import Movie
from app.scraping import tmdb_lookup as tmdb_core
from app.scraping.logger import logger
from app.scraping.tmdb_config import (
    TMDB_REFRESH_AFTER_DAYS,
    TMDB_STALE_REFRESH_BASE_PROBABILITY,
    TMDB_STALE_REFRESH_DAILY_INCREASE,
    TMDB_STALE_REFRESH_MAX_PROBABILITY,
)
from app.scraping.tmdb_normalization import _normalize_language_codes
from app.utils import now_amsterdam_naive


def _movie_to_tmdb_details(movie: Movie) -> tmdb_core.TmdbMovieDetails | None:
    """Convert a local Movie row into the TMDB details shape used by enrichers."""
    title = movie.title.strip()
    if not title:
        return None
    original_title = (
        movie.original_title.strip()
        if isinstance(movie.original_title, str) and movie.original_title.strip()
        else None
    )
    if original_title and original_title.casefold() == title.casefold():
        original_title = None
    return tmdb_core.TmdbMovieDetails(
        title=title,
        original_title=original_title,
        release_year=movie.release_year,
        directors=list(movie.directors) if movie.directors else [],
        poster_url=movie.poster_link,
        original_language=None,
        spoken_languages=(
            _normalize_language_codes(movie.languages) if movie.languages else None
        ),
        runtime_minutes=movie.duration,
        cast_names=None,
        enriched_at=movie.tmdb_last_enriched_at,
        genre_ids=None,
    )


def _load_existing_movie(tmdb_id: int) -> Movie | None:
    """Load an already persisted movie by TMDB ID."""
    with get_db_context() as session:
        return movies_crud.get_movie_by_id(session=session, id=tmdb_id)


def _age_days(movie: Movie, now: datetime) -> float | None:
    """Compute enrichment age in days for a local movie record."""
    enriched_at = movie.tmdb_last_enriched_at
    if enriched_at is None:
        return None
    return max(0.0, (now - enriched_at).total_seconds() / 86400.0)


def _stale_refresh_probability(age_days: float | None) -> float:
    """Return the probability of forcing a TMDB refresh for stale local metadata."""
    if age_days is None:
        # Unknown age; keep TMDB load low while still allowing eventual refresh.
        return TMDB_STALE_REFRESH_BASE_PROBABILITY
    if age_days < TMDB_REFRESH_AFTER_DAYS:
        return 0.0

    days_over_threshold = age_days - float(TMDB_REFRESH_AFTER_DAYS)
    probability = (
        TMDB_STALE_REFRESH_BASE_PROBABILITY
        + days_over_threshold * TMDB_STALE_REFRESH_DAILY_INCREASE
    )
    return min(
        TMDB_STALE_REFRESH_MAX_PROBABILITY,
        max(0.0, probability),
    )


def _resolve_existing_movie(tmdb_id: int) -> tmdb_core.ExistingTmdbResolution:
    """Decide whether local DB metadata is good enough or TMDB should be refetched."""
    movie = _load_existing_movie(tmdb_id)
    if movie is None:
        return tmdb_core.ExistingTmdbResolution(
            movie_data=None,
            should_refetch=True,
            decision_reason="movie_missing_in_db",
        )

    existing_data = _movie_to_tmdb_details(movie)
    if existing_data is None:
        return tmdb_core.ExistingTmdbResolution(
            movie_data=None,
            should_refetch=True,
            decision_reason="movie_missing_local_metadata",
        )

    age_days = _age_days(movie, now_amsterdam_naive())
    refresh_probability = _stale_refresh_probability(age_days)
    if refresh_probability <= 0.0:
        return tmdb_core.ExistingTmdbResolution(
            movie_data=existing_data,
            should_refetch=False,
            decision_reason="fresh_enrichment_in_db",
            age_days=age_days,
            refresh_probability=refresh_probability,
        )

    should_refetch = random.random() < refresh_probability
    return tmdb_core.ExistingTmdbResolution(
        movie_data=existing_data,
        should_refetch=should_refetch,
        decision_reason=(
            "stale_refresh_selected"
            if should_refetch
            else "stale_refresh_deferred_probability_gate"
        ),
        age_days=age_days,
        refresh_probability=refresh_probability,
    )


def get_tmdb_movie_details(tmdb_id: int) -> tmdb_core.TmdbMovieDetails | None:
    """Resolve TMDB details for a movie using memory cache, DB fallback, and network fetch."""
    cache_hit, cached = tmdb_core.get_memory_movie_details(tmdb_id)
    if cache_hit:
        return cached

    existing_resolution = _resolve_existing_movie(tmdb_id)
    logger.debug(
        "TMDB details decision for TMDB ID %s: %s (%s, age_days=%s, p=%.4f)",
        tmdb_id,
        "fetch network" if existing_resolution.should_refetch else "skip network",
        existing_resolution.decision_reason,
        (
            f"{existing_resolution.age_days:.2f}"
            if existing_resolution.age_days is not None
            else "n/a"
        ),
        existing_resolution.refresh_probability,
    )
    if (
        existing_resolution.movie_data is not None
        and not existing_resolution.should_refetch
    ):
        tmdb_core.set_memory_movie_details(tmdb_id, existing_resolution.movie_data)
        return existing_resolution.movie_data

    details = tmdb_core.fetch_tmdb_movie_details_sync(tmdb_id)
    if details is None:
        if existing_resolution.movie_data is not None:
            logger.debug(
                "TMDB details fetch unavailable for TMDB ID %s; using existing DB data",
                tmdb_id,
            )
            tmdb_core.set_memory_movie_details(tmdb_id, existing_resolution.movie_data)
            return existing_resolution.movie_data
        tmdb_core.set_memory_movie_details(tmdb_id, None)
        return None

    tmdb_core.set_memory_movie_details(tmdb_id, details)
    return details


async def get_tmdb_movie_details_async(
    *,
    session: aiohttp.ClientSession,
    tmdb_id: int,
) -> tmdb_core.TmdbMovieDetails | None:
    """Async variant of `get_tmdb_movie_details` using the shared aiohttp session."""
    cache_hit, cached = tmdb_core.get_memory_movie_details(tmdb_id)
    if cache_hit:
        return cached

    existing_resolution = await asyncio.to_thread(_resolve_existing_movie, tmdb_id)
    logger.debug(
        "TMDB details decision for TMDB ID %s: %s (%s, age_days=%s, p=%.4f)",
        tmdb_id,
        "fetch network" if existing_resolution.should_refetch else "skip network",
        existing_resolution.decision_reason,
        (
            f"{existing_resolution.age_days:.2f}"
            if existing_resolution.age_days is not None
            else "n/a"
        ),
        existing_resolution.refresh_probability,
    )
    if (
        existing_resolution.movie_data is not None
        and not existing_resolution.should_refetch
    ):
        tmdb_core.set_memory_movie_details(tmdb_id, existing_resolution.movie_data)
        return existing_resolution.movie_data

    details = await tmdb_core.fetch_tmdb_movie_details_async(
        session=session,
        tmdb_id=tmdb_id,
    )
    if details is None:
        if existing_resolution.movie_data is not None:
            logger.debug(
                "TMDB details fetch unavailable for TMDB ID %s; using existing DB data",
                tmdb_id,
            )
            tmdb_core.set_memory_movie_details(tmdb_id, existing_resolution.movie_data)
            return existing_resolution.movie_data
        tmdb_core.set_memory_movie_details(tmdb_id, None)
        return None

    tmdb_core.set_memory_movie_details(tmdb_id, details)
    return details


__all__ = [
    "get_tmdb_movie_details",
    "get_tmdb_movie_details_async",
]
