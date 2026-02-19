import asyncio
import os
import re
import traceback
from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, cast

import aiohttp

from app.api.deps import get_db_context
from app.crud import cinema as cinema_crud
from app.models.movie import MovieCreate
from app.models.showtime import ShowtimeCreate
from app.scraping.base_cinema_scraper import BaseCinemaScraper
from app.scraping.cinemas.amsterdam.eye import EyeScraper
from app.scraping.cinemas.amsterdam.fchyena import FCHyenaScraper
from app.scraping.cinemas.amsterdam.filmhallen import FilmHallenScraper
from app.scraping.cinemas.amsterdam.kriterion import KriterionScraper
from app.scraping.cinemas.amsterdam.lab111 import LAB111Scraper
from app.scraping.cinemas.amsterdam.themovies import TheMoviesScraper
from app.scraping.cinemas.amsterdam.uitkijk import UitkijkScraper
from app.scraping.logger import logger
from app.scraping.tmdb import find_tmdb_id_async
from app.services import movies as movies_service
from app.services import scrape_sync as scrape_sync_service
from app.services import showtimes as showtimes_service
from app.utils import clean_title, now_amsterdam_naive, to_amsterdam_time

from . import get_movies, get_showtimes
from .letterboxd.load_letterboxd_data import (
    is_letterboxd_temporarily_blocked,
    scrape_letterboxd_async,
)

ScraperFactory = Callable[[], BaseCinemaScraper]

SCRAPERS: list[ScraperFactory] = [
    EyeScraper,
    FCHyenaScraper,
    LAB111Scraper,
    UitkijkScraper,
    KriterionScraper,
    TheMoviesScraper,
    FilmHallenScraper,
]


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return max(1, int(raw))
    except ValueError:
        return default


CINEVILLE_CONCURRENCY = _env_int("CINEVILLE_CONCURRENCY", 15)
CINEMA_SCRAPER_CONCURRENCY = _env_int("CINEMA_SCRAPER_CONCURRENCY", 2)
CINEVILLE_HTTP_TOTAL_LIMIT = _env_int(
    "CINEVILLE_HTTP_TOTAL_LIMIT",
    40,
)
CINEVILLE_HTTP_PER_HOST_LIMIT = _env_int(
    "CINEVILLE_HTTP_PER_HOST_LIMIT",
    20,
)


@dataclass
class ScrapeExecutionSummary:
    deleted_showtimes: list[scrape_sync_service.DeletedShowtimeInfo] = field(
        default_factory=list
    )
    errors: list[str] = field(default_factory=list)
    missing_cinemas: list[str] = field(default_factory=list)
    missing_cinema_insert_failures: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class PreparedCinevilleShowtime:
    id: str
    start_date: str
    ticket_url: str | None
    venue_name: str


@dataclass(frozen=True)
class PreparedCinevilleMovie:
    production_id: str
    movie: MovieCreate
    showtimes: list[PreparedCinevilleShowtime]


CinevilleWorkerResult = tuple[PreparedCinevilleMovie | None, list[str]]


def _format_error_context(
    *,
    stage: str,
    error: Exception | str,
    source_stream: str | None = None,
    movie_title: str | None = None,
    production_id: str | None = None,
    showtime_event_id: str | None = None,
    venue_name: str | None = None,
) -> str:
    parts = [f"stage={stage}"]
    if source_stream:
        parts.append(f"source_stream={source_stream}")
    if movie_title:
        parts.append(f"movie_title={movie_title}")
    if production_id:
        parts.append(f"production_id={production_id}")
    if showtime_event_id:
        parts.append(f"showtime_event_id={showtime_event_id}")
    if venue_name:
        parts.append(f"venue_name={venue_name}")

    if isinstance(error, Exception):
        parts.append(f"error_type={type(error).__name__}")
        parts.append(f"error={error}")
        tb = traceback.extract_tb(error.__traceback__)
        if tb:
            last = tb[-1]
            parts.append(
                f"location={os.path.basename(last.filename)}:{last.lineno} ({last.name})"
            )
    else:
        parts.append(f"error={error}")
    return " | ".join(parts)


def _persist_cineville_results_batch(
    *,
    prepared_movies: list[PreparedCinevilleMovie],
    default_started_at: datetime,
) -> tuple[
    dict[str, list[scrape_sync_service.ObservedPresence]],
    dict[str, list[str]],
    dict[str, datetime],
    set[str],
    list[str],
]:
    observed_by_stream: dict[str, list[scrape_sync_service.ObservedPresence]] = (
        defaultdict(list)
    )
    stream_errors: dict[str, list[str]] = defaultdict(list)
    stream_started_at: dict[str, datetime] = {}
    missing_cinemas: set[str] = set()
    missing_cinema_insert_failures: list[str] = []

    with get_db_context() as session:
        cinema_id_by_name: dict[str, int] = {
            cinema.name: cinema.id
            for cinema in cinema_crud.get_cinemas(session=session)
            if cinema.cineville
        }
        inserted_movie_ids: set[int] = set()

        for prepared_movie in prepared_movies:
            movie = prepared_movie.movie
            if movie.id not in inserted_movie_ids:
                movies_service.upsert_movie(
                    session=session,
                    movie_create=movie,
                    commit=False,
                )
                inserted_movie_ids.add(movie.id)
                logger.info(
                    f"Inserted movie: {movie.title} (TMDB ID: {movie.id}, Letterboxd slug: {movie.letterboxd_slug})"
                )

            for showtime_data in prepared_movie.showtimes:
                source_stream: str | None = None
                start_date = None
                venue_name = showtime_data.venue_name
                try:
                    start_date = to_amsterdam_time(showtime_data.start_date)

                    cinema_id = cinema_id_by_name.get(venue_name)
                    if cinema_id is None:
                        cinema_id = cinema_crud.get_cinema_id_by_name(
                            session=session,
                            name=venue_name,
                        )
                        if cinema_id is None:
                            raise ValueError(
                                f"Cinema not found for Cineville venue '{venue_name}'"
                            )
                        cinema_id_by_name[venue_name] = cinema_id

                    source_stream = f"cineville:{cinema_id}"
                    stream_started_at.setdefault(source_stream, default_started_at)

                    showtime = ShowtimeCreate(
                        datetime=start_date,
                        ticket_link=showtime_data.ticket_url,
                        movie_id=movie.id,
                        cinema_id=cinema_id,
                    )
                    db_showtime = showtimes_service.upsert_showtime(
                        session=session,
                        showtime_create=showtime,
                        commit=False,
                    )
                    observed_by_stream[source_stream].append(
                        scrape_sync_service.ObservedPresence(
                            source_event_key=f"event:{showtime_data.id}",
                            showtime_id=db_showtime.id,
                        )
                    )
                except Exception as e:
                    if _is_missing_cinema_insert_error(e):
                        missing_cinemas.add(venue_name)
                        missing_cinema_insert_failures.append(
                            _format_error_context(
                                stage="missing_cinema_insert_failure",
                                error=e,
                                source_stream=source_stream,
                                movie_title=movie.title,
                                production_id=prepared_movie.production_id,
                                showtime_event_id=showtime_data.id,
                                venue_name=venue_name,
                            )
                        )
                    error_context = _format_error_context(
                        stage="persist_showtime",
                        error=e,
                        source_stream=source_stream,
                        movie_title=movie.title,
                        production_id=prepared_movie.production_id,
                        showtime_event_id=showtime_data.id,
                        venue_name=venue_name,
                    )
                    stream_errors[source_stream or "cineville:unknown"].append(
                        error_context
                    )
                    logger.error(
                        f"Failed to insert showtime for movie: {movie.title} at {venue_name} on {start_date}. Error: {e}"
                    )
        session.commit()
    return (
        observed_by_stream,
        stream_errors,
        stream_started_at,
        missing_cinemas,
        missing_cinema_insert_failures,
    )


def _is_missing_cinema_insert_error(error: Exception) -> bool:
    current: BaseException | None = error
    seen: set[int] = set()
    while current is not None:
        current_id = id(current)
        if current_id in seen:
            break
        seen.add(current_id)
        message = f"{type(current).__name__}: {current}".lower()
        if "cinema not found for cineville venue" in message:
            return True
        if "foreign key" in message and "cinema" in message:
            return True
        if "showtime_cinema_id_fkey" in message:
            return True
        if "showtime" in message and "cinema_id" in message and "violat" in message:
            return True
        current = (
            current.__cause__ if current.__cause__ is not None else current.__context__
        )
    return False


def _expected_cinema_name(scraper_name: str) -> str | None:
    return {
        "EyeScraper": "Eye",
        "FCHyenaScraper": "FC Hyena",
        "LAB111Scraper": "LAB111",
        "UitkijkScraper": "De Uitkijk",
        "KriterionScraper": "Kriterion",
        "TheMoviesScraper": "The Movies",
        "FilmHallenScraper": "Filmhallen",
    }.get(scraper_name)


async def _process_cineville_movie_async(
    *,
    movie_data: Any,
    session: aiohttp.ClientSession,
) -> tuple[
    PreparedCinevilleMovie | None,
    list[str],
]:
    movie_title = getattr(movie_data, "title", "<unknown>")
    production_id = str(getattr(movie_data, "id", "<unknown>"))
    try:
        title_query = clean_title(movie_data.title)
        actors = movie_data.cast
        actor = actors[0] if actors else None
        directors = movie_data.directors or []

        try:
            tmdb_id = await find_tmdb_id_async(
                session=session,
                title_query=title_query,
                actor_name=actor,
                director_names=directors,
            )
        except Exception as e:
            return (
                None,
                [
                    _format_error_context(
                        stage="tmdb_lookup",
                        error=e,
                        movie_title=movie_title,
                        production_id=production_id,
                    )
                ],
            )
        if tmdb_id is None:
            logger.warning(f"TMDB ID not found for movie: {title_query}")
            return None, []

        try:
            letterboxd_data = await scrape_letterboxd_async(
                tmdb_id=tmdb_id,
                session=session,
            )
        except Exception as e:
            return (
                None,
                [
                    _format_error_context(
                        stage="letterboxd_lookup",
                        error=e,
                        movie_title=movie_title,
                        production_id=production_id,
                    )
                ],
            )
        if letterboxd_data is None:
            if is_letterboxd_temporarily_blocked():
                logger.debug(
                    f"Letterboxd temporarily blocked; skipping TMDB ID {tmdb_id}"
                )
            else:
                logger.warning(f"Letterboxd data not found for TMDB ID: {tmdb_id}")
            return None, []

        try:
            showtimes_data = await get_showtimes.get_showtimes_json_async(
                productionId=movie_data.id,
                session=session,
            )
        except Exception as e:
            return (
                None,
                [
                    _format_error_context(
                        stage="fetch_cineville_showtimes",
                        error=e,
                        movie_title=movie_title,
                        production_id=production_id,
                    )
                ],
            )
        movie = MovieCreate(
            title=letterboxd_data.title,
            id=tmdb_id,
            poster_link=letterboxd_data.poster_url,
            letterboxd_slug=letterboxd_data.slug,
            top250=letterboxd_data.top250,
            directors=letterboxd_data.directors,
            release_year=letterboxd_data.release_year,
            rating=letterboxd_data.rating,
            original_title=letterboxd_data.original_title,
            letterboxd_last_enriched_at=letterboxd_data.enriched_at,
        )
        prepared_showtimes = [
            PreparedCinevilleShowtime(
                id=showtime.id,
                start_date=showtime.startDate,
                ticket_url=showtime.ticketUrl,
                venue_name=showtime.venueName,
            )
            for showtime in showtimes_data
        ]
        return (
            PreparedCinevilleMovie(
                production_id=production_id,
                movie=movie,
                showtimes=prepared_showtimes,
            ),
            [],
        )
    except Exception as e:
        logger.exception(f"Failed processing Cineville movie {movie_title}")
        return (
            None,
            [
                _format_error_context(
                    stage="process_cineville_movie_unexpected",
                    error=e,
                    movie_title=movie_title,
                    production_id=production_id,
                )
            ],
        )


async def scrape_cineville_async() -> ScrapeExecutionSummary:
    summary = ScrapeExecutionSummary()
    default_started_at = now_amsterdam_naive()
    batch_persist_error: str | None = None
    prepared_movies: list[PreparedCinevilleMovie] = []
    observed_by_stream: dict[str, list[scrape_sync_service.ObservedPresence]] = (
        defaultdict(list)
    )
    stream_errors: dict[str, list[str]] = defaultdict(list)
    stream_started_at: dict[str, datetime] = {}
    semaphore = asyncio.Semaphore(CINEVILLE_CONCURRENCY)

    connector = aiohttp.TCPConnector(
        limit=CINEVILLE_HTTP_TOTAL_LIMIT,
        limit_per_host=CINEVILLE_HTTP_PER_HOST_LIMIT,
    )
    results: list[CinevilleWorkerResult | Exception] = []
    async with aiohttp.ClientSession(
        timeout=aiohttp.ClientTimeout(total=20),
        connector=connector,
    ) as http_session:
        movies_data = await get_movies.get_movies_json_async(session=http_session)
        if not movies_data:
            batch_persist_error = (
                "stage=fetch_cineville_movies | "
                "error=No movies returned from Cineville API"
            )
            summary.errors.append(batch_persist_error)
        else:

            async def process_movie(movie_data: Any) -> CinevilleWorkerResult:
                async with semaphore:
                    return await _process_cineville_movie_async(
                        movie_data=movie_data,
                        session=http_session,
                    )

            results = cast(
                list[CinevilleWorkerResult | Exception],
                await asyncio.gather(
                    *(process_movie(movie_data) for movie_data in movies_data),
                    return_exceptions=True,
                ),
            )

    for result in results:
        if isinstance(result, Exception):
            logger.error(f"Cineville worker failed: {result}")
            summary.errors.append(
                _format_error_context(
                    stage="cineville_worker_gather",
                    error=result,
                )
            )
            continue
        prepared_movie, worker_errors = result
        summary.errors.extend(worker_errors)
        if prepared_movie is not None:
            prepared_movies.append(prepared_movie)

    if batch_persist_error is None:
        try:
            (
                observed_by_stream,
                stream_errors,
                stream_started_at,
                missing_cinemas,
                missing_cinema_insert_failures,
            ) = await asyncio.to_thread(
                _persist_cineville_results_batch,
                prepared_movies=prepared_movies,
                default_started_at=default_started_at,
            )
            summary.missing_cinemas.extend(sorted(missing_cinemas))
            summary.missing_cinema_insert_failures.extend(
                missing_cinema_insert_failures
            )
        except Exception as e:
            batch_persist_error = _format_error_context(
                stage="persist_cineville_batch",
                error=e,
            )
            summary.errors.append(batch_persist_error)
            stream_errors = defaultdict(
                list,
                {"cineville:unknown": [batch_persist_error]},
            )

    with get_db_context() as db_session:
        cineville_streams = {
            f"cineville:{cinema.id}"
            for cinema in cinema_crud.get_cinemas(session=db_session)
            if cinema.cineville
        }
    if batch_persist_error is not None:
        for source_stream in cineville_streams:
            stream_errors[source_stream].append(batch_persist_error)

    all_streams = set(cineville_streams)
    all_streams.update(observed_by_stream.keys())
    all_streams.update(stream_errors.keys())

    for source_stream in all_streams:
        started_at = stream_started_at.get(source_stream, default_started_at)
        errors = stream_errors.get(source_stream, [])
        if errors:
            summary.errors.append(f"{source_stream}: {'; '.join(errors)}")
            with get_db_context() as db_session:
                scrape_sync_service.record_failed_run(
                    session=db_session,
                    source_stream=source_stream,
                    error="; ".join(errors),
                    started_at=started_at,
                )
            continue

        observed = observed_by_stream.get(source_stream, [])
        with get_db_context() as db_session:
            status, deleted_showtimes = scrape_sync_service.record_success_run(
                session=db_session,
                source_stream=source_stream,
                observed_presences=observed,
                started_at=started_at,
            )
        summary.deleted_showtimes.extend(deleted_showtimes)
        logger.info(
            f"Cineville sync for {source_stream}: status={status.value}, observed={len(observed)}, deleted={len(deleted_showtimes)}"
        )
    return summary


def scrape_cineville() -> ScrapeExecutionSummary:
    return asyncio.run(scrape_cineville_async())


async def _run_single_cinema_scraper(
    scraper_factory: ScraperFactory,
) -> ScrapeExecutionSummary:
    summary = ScrapeExecutionSummary()
    started_at = now_amsterdam_naive()
    scraper_name = getattr(scraper_factory, "__name__", "unknown_scraper")
    source_stream = f"cinema_scraper:{scraper_name}"
    try:
        scraper: BaseCinemaScraper = await asyncio.to_thread(scraper_factory)
        cinema_id = getattr(scraper, "cinema_id", None)
        if cinema_id is None:
            expected_cinema_name = _expected_cinema_name(scraper_name)
            raise ValueError(
                f"Cinema {expected_cinema_name or scraper_name} not found in database"
            )
        if cinema_id is not None:
            source_stream = f"cinema_scraper:{cinema_id}"

        observed_pairs = await asyncio.to_thread(scraper.scrape)
        observed = [
            scrape_sync_service.ObservedPresence(
                source_event_key=source_event_key,
                showtime_id=showtime_id,
            )
            for source_event_key, showtime_id in observed_pairs
        ]
        with get_db_context() as db_session:
            status, deleted_showtimes = scrape_sync_service.record_success_run(
                session=db_session,
                source_stream=source_stream,
                observed_presences=observed,
                started_at=started_at,
            )
        summary.deleted_showtimes.extend(deleted_showtimes)
        logger.info(
            f"Cinema scraper sync for {source_stream}: status={status.value}, observed={len(observed)}, deleted={len(deleted_showtimes)}"
        )
    except Exception as e:
        missing_match = re.search(
            r"Cinema (.+?) not found in database",
            str(e),
        )
        if missing_match:
            summary.missing_cinemas.append(missing_match.group(1))
        summary.errors.append(
            _format_error_context(
                stage="run_cinema_scraper",
                error=e,
                source_stream=source_stream,
                movie_title=scraper_name,
            )
        )
        with get_db_context() as db_session:
            scrape_sync_service.record_failed_run(
                session=db_session,
                source_stream=source_stream,
                error=str(e),
                started_at=started_at,
            )
        logger.exception(f"Error occurred while scraping with {scraper_name}")
    return summary


async def run_cinema_scrapers_async() -> ScrapeExecutionSummary:
    summary = ScrapeExecutionSummary()
    semaphore = asyncio.Semaphore(CINEMA_SCRAPER_CONCURRENCY)

    async def run_with_limit(
        scraper_factory: ScraperFactory,
    ) -> ScrapeExecutionSummary:
        async with semaphore:
            return await _run_single_cinema_scraper(scraper_factory)

    results = await asyncio.gather(
        *(run_with_limit(scraper_factory) for scraper_factory in SCRAPERS)
    )
    for result in results:
        summary.deleted_showtimes.extend(result.deleted_showtimes)
        summary.errors.extend(result.errors)
        summary.missing_cinemas.extend(result.missing_cinemas)
        summary.missing_cinema_insert_failures.extend(
            result.missing_cinema_insert_failures
        )
    return summary


def run_cinema_scrapers() -> ScrapeExecutionSummary:
    return asyncio.run(run_cinema_scrapers_async())


if __name__ == "__main__":
    logger.info("Starting Cineville scraping...")
    scrape_cineville()
    logger.info("Cineville scraping completed.")
    logger.info("Starting cinema scrapers...")
    run_cinema_scrapers()
    logger.info("Cinema scrapers completed.")
