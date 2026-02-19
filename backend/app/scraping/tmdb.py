import asyncio
import hashlib
import html
import json
import os
import random
import re
import unicodedata
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from threading import Event, Lock, local
from typing import Any

import aiohttp
import requests
from rapidfuzz import fuzz
from requests.adapters import HTTPAdapter
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlmodel import select
from urllib3.util.retry import Retry

from app.api.deps import get_db_context
from app.core.config import settings
from app.crud import movie as movies_crud
from app.models.movie import Movie
from app.models.tmdb_lookup_cache import TmdbLookupCache
from app.scraping.logger import logger
from app.utils import now_amsterdam_naive

TMDB_API_KEY = settings.TMDB_KEY
SEARCH_PERSON_URL = "https://api.themoviedb.org/3/search/person"
CREDITS_URL_TEMPLATE = "https://api.themoviedb.org/3/person/{id}/movie_credits"
MOVIE_URL_TEMPLATE = "https://api.themoviedb.org/3/movie/{id}"
TMDB_POSTER_BASE_URL = "https://image.tmdb.org/t/p/w342"
LETTERBOXD_SEARCH_URL = "https://letterboxd.com/search/"
TMDB_SEARCH_URL = "https://api.themoviedb.org/3/search/movie"


def _env_non_negative_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return max(0, int(raw))
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return max(0.0, float(raw))
    except ValueError:
        return default


def _env_probability(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        parsed = float(raw)
    except ValueError:
        return default
    return min(1.0, max(0.0, parsed))


TMDB_REFRESH_AFTER_DAYS = _env_non_negative_int("TMDB_REFRESH_AFTER_DAYS", 5)
TMDB_STALE_REFRESH_BASE_PROBABILITY = _env_probability(
    "TMDB_STALE_REFRESH_BASE_PROBABILITY",
    0.05,
)
TMDB_STALE_REFRESH_DAILY_INCREASE = _env_float(
    "TMDB_STALE_REFRESH_DAILY_INCREASE",
    0.03,
)
TMDB_STALE_REFRESH_MAX_PROBABILITY = _env_probability(
    "TMDB_STALE_REFRESH_MAX_PROBABILITY",
    1.0,
)

FUZZ_THRESHOLD = 60  # Minimum score for a match
RELAXED_FUZZ_THRESHOLD = 45
STRONG_METADATA_FUZZ_THRESHOLD = 35
TMDB_LOOKUP_PAYLOAD_VERSION = 2
PERSON_NAME_SPLIT_RE = re.compile(
    r"\s*(?:,|/|;|&|\band\b|\ben\b)\s*",
    flags=re.IGNORECASE,
)
NON_MOVIE_TITLE_MARKERS = (
    "filmquiz",
    "quiz",
    "masterclass",
    "workshop",
    "filmcursus",
    "filmcollege",
    "lecture",
    "talk",
    "festival",
    "on tour",
    "silent disco",
    "filmblok",
    "filmclub",
    "cinemini",
    "peuterfilmpret",
    "sneak preview",
    "shorts collection",
)
PLACEHOLDER_PERSON_VALUES = {
    "",
    "?",
    "unknown",
    "onbekend",
    "nvt",
    "n.v.t",
    "none",
    "div",
    "diversen",
    "diverse",
    "various",
}

_thread_local = local()
_tmdb_cache_available: bool | None = None
_tmdb_lookup_audit_lock = Lock()
_tmdb_lookup_audit_events: list[dict[str, Any]] = []
_lookup_result_cache_lock = Lock()
_lookup_result_cache: dict[tuple[str, str], int | None] = {}
_inflight_lookup_lock = Lock()
_inflight_lookup_events: dict[tuple[str, str], Event] = {}
_person_ids_cache_lock = Lock()
_person_ids_cache: dict[str, tuple[str, ...]] = {}
_person_movies_cache_lock = Lock()
_person_movies_cache: dict[tuple[str, str, int | None], list[dict[str, Any]]] = {}
_title_search_cache_lock = Lock()
_title_search_cache: dict[str, list[dict[str, Any]]] = {}
_movie_details_cache_lock = Lock()
_movie_details_cache: dict[int, "TmdbMovieDetails | None"] = {}


@dataclass(frozen=True)
class TmdbMovieDetails:
    title: str
    original_title: str | None
    release_year: int | None
    directors: list[str]
    poster_url: str | None
    enriched_at: datetime | None = None


@dataclass(frozen=True)
class ExistingTmdbResolution:
    movie_data: TmdbMovieDetails | None
    should_refetch: bool
    decision_reason: str
    age_days: float | None = None
    refresh_probability: float = 0.0


def _get_session() -> requests.Session:
    session = getattr(_thread_local, "session", None)
    if session is None:
        session = requests.Session()
        retry = Retry(
            total=15,
            backoff_factor=1,
            status_forcelist=[429, 500, 502, 503, 504],
        )
        session.mount("https://", HTTPAdapter(max_retries=retry))
        _thread_local.session = session
    return session


def _build_lookup_payload(
    *,
    title_query: str,
    director_names: list[str],
    actor_name: str | None,
    year: int | None,
) -> dict[str, Any]:
    normalized_title_query = _normalize_title_search_query(title_query)
    title_variants = _build_title_variants(normalized_title_query)
    normalized_director_names = _expand_person_names(director_names)
    normalized_actor_names = _expand_person_names([actor_name] if actor_name else [])
    return {
        "version": TMDB_LOOKUP_PAYLOAD_VERSION,
        "title_query": normalized_title_query,
        "title_variants": title_variants,
        "director_names": normalized_director_names,
        "actor_names": normalized_actor_names,
        "year": year,
    }


def _payload_to_canonical_json(payload: dict[str, Any]) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def _payload_hash(payload_json: str) -> str:
    return hashlib.sha256(payload_json.encode("utf-8")).hexdigest()


def _payload_string_list(payload: dict[str, Any], key: str) -> list[str]:
    value = payload.get(key, [])
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if str(item).strip()]


def _memory_lookup_cache_get(
    *,
    payload_json: str,
    payload_hash: str,
) -> tuple[bool, int | None]:
    key = (payload_hash, payload_json)
    with _lookup_result_cache_lock:
        if key not in _lookup_result_cache:
            return False, None
        return True, _lookup_result_cache[key]


def _memory_lookup_cache_set(
    *,
    payload_json: str,
    payload_hash: str,
    tmdb_id: int | None,
) -> None:
    key = (payload_hash, payload_json)
    with _lookup_result_cache_lock:
        _lookup_result_cache[key] = tmdb_id


def _begin_inflight_lookup(
    *,
    payload_json: str,
    payload_hash: str,
) -> tuple[bool, Event]:
    key = (payload_hash, payload_json)
    with _inflight_lookup_lock:
        existing = _inflight_lookup_events.get(key)
        if existing is not None:
            return False, existing
        event = Event()
        _inflight_lookup_events[key] = event
        return True, event


def _finish_inflight_lookup(
    *,
    payload_json: str,
    payload_hash: str,
    event: Event,
) -> None:
    key = (payload_hash, payload_json)
    with _inflight_lookup_lock:
        current = _inflight_lookup_events.get(key)
        if current is event:
            del _inflight_lookup_events[key]
    event.set()


def _memory_person_ids_get(name: str) -> list[str] | None:
    with _person_ids_cache_lock:
        cached = _person_ids_cache.get(name)
    if cached is None:
        return None
    return list(cached)


def _memory_person_ids_set(name: str, person_ids: Sequence[str]) -> None:
    with _person_ids_cache_lock:
        _person_ids_cache[name] = tuple(str(person_id) for person_id in person_ids)


def _memory_person_movies_get(
    *,
    person_id: str,
    job: str,
    year: int | None,
) -> list[dict[str, Any]] | None:
    key = (person_id, job, year)
    with _person_movies_cache_lock:
        cached = _person_movies_cache.get(key)
    if cached is None:
        return None
    return list(cached)


def _memory_person_movies_set(
    *,
    person_id: str,
    job: str,
    year: int | None,
    movies: list[dict[str, Any]],
) -> None:
    key = (person_id, job, year)
    with _person_movies_cache_lock:
        _person_movies_cache[key] = list(movies)


def _memory_title_search_get(title: str) -> list[dict[str, Any]] | None:
    key = title.strip().lower()
    with _title_search_cache_lock:
        cached = _title_search_cache.get(key)
    if cached is None:
        return None
    return list(cached)


def _memory_title_search_set(title: str, results: list[dict[str, Any]]) -> None:
    key = title.strip().lower()
    with _title_search_cache_lock:
        _title_search_cache[key] = list(results)


def _memory_movie_details_get(tmdb_id: int) -> tuple[bool, TmdbMovieDetails | None]:
    with _movie_details_cache_lock:
        if tmdb_id not in _movie_details_cache:
            return False, None
        return True, _movie_details_cache[tmdb_id]


def _memory_movie_details_set(tmdb_id: int, details: TmdbMovieDetails | None) -> None:
    with _movie_details_cache_lock:
        _movie_details_cache[tmdb_id] = details


def _movie_to_tmdb_details(movie: Movie) -> TmdbMovieDetails | None:
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
    return TmdbMovieDetails(
        title=title,
        original_title=original_title,
        release_year=movie.release_year,
        directors=list(movie.directors) if movie.directors else [],
        poster_url=movie.poster_link,
        enriched_at=movie.tmdb_last_enriched_at,
    )


def _load_existing_movie(tmdb_id: int) -> Movie | None:
    with get_db_context() as session:
        return movies_crud.get_movie_by_id(session=session, id=tmdb_id)


def _age_days(movie: Movie, now: datetime) -> float | None:
    enriched_at = movie.tmdb_last_enriched_at
    if enriched_at is None:
        return None
    return max(0.0, (now - enriched_at).total_seconds() / 86400.0)


def _stale_refresh_probability(age_days: float | None) -> float:
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


def _resolve_existing_movie(tmdb_id: int) -> ExistingTmdbResolution:
    movie = _load_existing_movie(tmdb_id)
    if movie is None:
        return ExistingTmdbResolution(
            movie_data=None,
            should_refetch=True,
            decision_reason="movie_missing_in_db",
        )

    existing_data = _movie_to_tmdb_details(movie)
    if existing_data is None:
        return ExistingTmdbResolution(
            movie_data=None,
            should_refetch=True,
            decision_reason="movie_missing_local_metadata",
        )

    age_days = _age_days(movie, now_amsterdam_naive())
    refresh_probability = _stale_refresh_probability(age_days)
    if refresh_probability <= 0.0:
        return ExistingTmdbResolution(
            movie_data=existing_data,
            should_refetch=False,
            decision_reason="fresh_enrichment_in_db",
            age_days=age_days,
            refresh_probability=refresh_probability,
        )

    should_refetch = random.random() < refresh_probability
    return ExistingTmdbResolution(
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


def _parse_tmdb_movie_details(
    payload: dict[str, Any],
    *,
    enriched_at: datetime | None,
) -> TmdbMovieDetails | None:
    title_raw = payload.get("title")
    original_title_raw = payload.get("original_title")
    title = title_raw.strip() if isinstance(title_raw, str) else ""
    original_title = (
        original_title_raw.strip() if isinstance(original_title_raw, str) else None
    )
    if not title and original_title:
        title = original_title
    if not title:
        return None
    if original_title and original_title.casefold() == title.casefold():
        original_title = None

    release_year = _movie_release_year(payload)
    credits = payload.get("credits")
    crew = credits.get("crew", []) if isinstance(credits, dict) else []
    directors: list[str] = []
    seen: set[str] = set()
    for member in crew:
        if not isinstance(member, dict) or member.get("job") != "Director":
            continue
        name_raw = member.get("name")
        if not isinstance(name_raw, str):
            continue
        name = name_raw.strip()
        if not name:
            continue
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        directors.append(name)

    poster_path = payload.get("poster_path")
    poster_url = (
        f"{TMDB_POSTER_BASE_URL}{poster_path}"
        if isinstance(poster_path, str) and poster_path.strip()
        else None
    )

    return TmdbMovieDetails(
        title=title,
        original_title=original_title,
        release_year=release_year,
        directors=directors,
        poster_url=poster_url,
        enriched_at=enriched_at,
    )


def _fetch_tmdb_movie_details_sync(tmdb_id: int) -> TmdbMovieDetails | None:
    url = MOVIE_URL_TEMPLATE.format(id=tmdb_id)
    try:
        response = _get_session().get(
            url,
            params={
                "api_key": TMDB_API_KEY,
                "append_to_response": "credits",
            },
        )
        response.raise_for_status()
    except requests.RequestException as e:
        logger.warning(f"Failed to fetch TMDB movie details for {tmdb_id}. Error: {e}")
        return None

    payload = response.json()
    if not isinstance(payload, dict):
        logger.warning(f"Unexpected TMDB movie details payload for {tmdb_id}.")
        return None

    details = _parse_tmdb_movie_details(payload, enriched_at=now_amsterdam_naive())
    return details


async def _fetch_tmdb_movie_details_async(
    *,
    session: aiohttp.ClientSession,
    tmdb_id: int,
) -> TmdbMovieDetails | None:
    url = MOVIE_URL_TEMPLATE.format(id=tmdb_id)
    payload = await _get_json_async(
        session=session,
        url=url,
        params={
            "api_key": TMDB_API_KEY,
            "append_to_response": "credits",
        },
    )
    if payload is None:
        return None
    return _parse_tmdb_movie_details(payload, enriched_at=now_amsterdam_naive())


def get_tmdb_movie_details(tmdb_id: int) -> TmdbMovieDetails | None:
    cache_hit, cached = _memory_movie_details_get(tmdb_id)
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
        _memory_movie_details_set(tmdb_id, existing_resolution.movie_data)
        return existing_resolution.movie_data

    details = _fetch_tmdb_movie_details_sync(tmdb_id)
    if details is None:
        if existing_resolution.movie_data is not None:
            logger.debug(
                "TMDB details fetch unavailable for TMDB ID %s; using existing DB data",
                tmdb_id,
            )
            _memory_movie_details_set(tmdb_id, existing_resolution.movie_data)
            return existing_resolution.movie_data
        _memory_movie_details_set(tmdb_id, None)
        return None

    _memory_movie_details_set(tmdb_id, details)
    return details


async def get_tmdb_movie_details_async(
    *,
    session: aiohttp.ClientSession,
    tmdb_id: int,
) -> TmdbMovieDetails | None:
    cache_hit, cached = _memory_movie_details_get(tmdb_id)
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
        _memory_movie_details_set(tmdb_id, existing_resolution.movie_data)
        return existing_resolution.movie_data

    details = await _fetch_tmdb_movie_details_async(session=session, tmdb_id=tmdb_id)
    if details is None:
        if existing_resolution.movie_data is not None:
            logger.debug(
                "TMDB details fetch unavailable for TMDB ID %s; using existing DB data",
                tmdb_id,
            )
            _memory_movie_details_set(tmdb_id, existing_resolution.movie_data)
            return existing_resolution.movie_data
        _memory_movie_details_set(tmdb_id, None)
        return None

    _memory_movie_details_set(tmdb_id, details)
    return details


def _get_cached_tmdb_id(
    *,
    payload_json: str,
    payload_hash: str,
) -> tuple[bool, int | None]:
    global _tmdb_cache_available
    if _tmdb_cache_available is False:
        return False, None
    try:
        with get_db_context() as session:
            stmt = select(TmdbLookupCache).where(
                TmdbLookupCache.lookup_hash == payload_hash,
                TmdbLookupCache.lookup_payload == payload_json,
            )
            cached = session.exec(stmt).first()
            _tmdb_cache_available = True
            if cached is None:
                return False, None
            return True, cached.tmdb_id
    except SQLAlchemyError:
        if _tmdb_cache_available is not False:
            logger.debug("TMDB cache unavailable; falling back to uncached lookups.")
        _tmdb_cache_available = False
        return False, None


def _store_cached_tmdb_id(
    *,
    payload_json: str,
    payload_hash: str,
    tmdb_id: int | None,
) -> None:
    global _tmdb_cache_available
    if _tmdb_cache_available is False:
        return
    now = now_amsterdam_naive()
    try:
        with get_db_context() as session:
            stmt = select(TmdbLookupCache).where(
                TmdbLookupCache.lookup_hash == payload_hash,
                TmdbLookupCache.lookup_payload == payload_json,
            )
            cached = session.exec(stmt).first()
            if cached is None:
                session.add(
                    TmdbLookupCache(
                        lookup_hash=payload_hash,
                        lookup_payload=payload_json,
                        tmdb_id=tmdb_id,
                        created_at=now,
                        updated_at=now,
                    )
                )
            else:
                cached.tmdb_id = tmdb_id
                cached.updated_at = now
            session.commit()
            _tmdb_cache_available = True
    except IntegrityError:
        logger.debug("TMDB cache write conflict, another worker likely wrote it first.")
    except SQLAlchemyError:
        if _tmdb_cache_available is not False:
            logger.debug("TMDB cache unavailable; skipping cache writes.")
        _tmdb_cache_available = False


def _record_tmdb_lookup_event(
    *,
    payload_json: str,
    tmdb_id: int | None,
    cache_hit: bool,
    cache_source: str | None = None,
) -> None:
    try:
        payload = json.loads(payload_json)
    except json.JSONDecodeError:
        payload = {"raw_payload": payload_json}
    event = {
        "timestamp": now_amsterdam_naive().isoformat(),
        "payload": payload,
        "tmdb_id": tmdb_id,
        "cache_hit": cache_hit,
    }
    if cache_source is not None:
        event["cache_source"] = cache_source
    with _tmdb_lookup_audit_lock:
        _tmdb_lookup_audit_events.append(event)


def consume_tmdb_lookup_events() -> list[dict[str, Any]]:
    with _tmdb_lookup_audit_lock:
        events = list(_tmdb_lookup_audit_events)
        _tmdb_lookup_audit_events.clear()
    return events


async def _get_json_async(
    *,
    session: aiohttp.ClientSession,
    url: str,
    params: dict[str, str],
) -> dict[str, Any] | None:
    try:
        async with session.get(url, params=params) as response:
            response.raise_for_status()
            payload = await response.json()
    except (aiohttp.ClientError, asyncio.TimeoutError) as e:
        logger.warning(f"TMDB request failed for {url}. Error: {e}")
        return None
    if not isinstance(payload, dict):
        logger.warning(f"Unexpected TMDB payload for {url}.")
        return None
    return payload


def _extract_ids(items: Any) -> list[str]:
    if not isinstance(items, list):
        return []
    ids: list[str] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        item_id = _movie_id(item)
        if item_id is not None:
            ids.append(str(item_id))
    return ids


def get_person_ids(name: str) -> Sequence[str]:
    cached = _memory_person_ids_get(name)
    if cached is not None:
        return cached

    try:
        res = _get_session().get(
            SEARCH_PERSON_URL, params={"api_key": TMDB_API_KEY, "query": name}
        )
        res.raise_for_status()
    except requests.RequestException as e:
        logger.warning(f"Failed to fetch person IDs for {name}. Error: {e}")
        return []
    response = res.json()

    results = response.get("results", [])
    person_ids = _extract_ids(results)
    if not person_ids:
        logger.warning(f"{name} could not be found on TMDB.")
        _memory_person_ids_set(name, [])
        return []

    _memory_person_ids_set(name, person_ids)
    return person_ids


async def get_person_ids_async(
    *,
    session: aiohttp.ClientSession,
    name: str,
) -> Sequence[str]:
    cached = _memory_person_ids_get(name)
    if cached is not None:
        return cached

    response = await _get_json_async(
        session=session,
        url=SEARCH_PERSON_URL,
        params={"api_key": TMDB_API_KEY, "query": name},
    )
    if response is None:
        return []

    results = response.get("results", [])
    person_ids = _extract_ids(results)
    if not person_ids:
        logger.warning(f"{name} could not be found on TMDB.")
        _memory_person_ids_set(name, [])
        return []

    _memory_person_ids_set(name, person_ids)
    return person_ids


def search_tmdb(title: str) -> list[dict[str, Any]]:
    cached = _memory_title_search_get(title)
    if cached is not None:
        return cached

    params = {
        "api_key": TMDB_API_KEY,
        "query": title,
    }

    try:
        response = _get_session().get(TMDB_SEARCH_URL, params=params)
        response.raise_for_status()
    except requests.RequestException as e:
        logger.warning(f"Failed to search TMDB for title '{title}'. Error: {e}")
        return []
    raw_results = response.json().get("results", [])
    if not isinstance(raw_results, list):
        _memory_title_search_set(title, [])
        return []
    results = [item for item in raw_results if isinstance(item, dict)]
    _memory_title_search_set(title, results)
    return results


async def search_tmdb_async(
    *,
    session: aiohttp.ClientSession,
    title: str,
) -> list[dict[str, Any]]:
    cached = _memory_title_search_get(title)
    if cached is not None:
        return cached

    response = await _get_json_async(
        session=session,
        url=TMDB_SEARCH_URL,
        params={"api_key": TMDB_API_KEY, "query": title},
    )
    if response is None:
        return []
    results = response.get("results", [])
    if not isinstance(results, list):
        return []
    parsed_results = [item for item in results if isinstance(item, dict)]
    _memory_title_search_set(title, parsed_results)
    return parsed_results


def _search_tmdb_with_variants(title_variants: Sequence[str]) -> list[dict[str, Any]]:
    merged_results: list[dict[str, Any]] = []
    for variant in title_variants:
        if not variant:
            continue
        merged_results.extend(search_tmdb(variant))
    return _dedupe_movies_by_id(merged_results)


async def _search_tmdb_with_variants_async(
    *,
    session: aiohttp.ClientSession,
    title_variants: Sequence[str],
) -> list[dict[str, Any]]:
    queries = [variant for variant in title_variants if variant]
    if not queries:
        return []
    result_lists = await asyncio.gather(
        *(search_tmdb_async(session=session, title=query) for query in queries),
        return_exceptions=False,
    )
    merged_results = [movie for result in result_lists for movie in result]
    return _dedupe_movies_by_id(merged_results)


def get_persons_movies(
    person_id: str, job: str = "Director", year: int | None = None
) -> list[dict[str, Any]]:
    cached = _memory_person_movies_get(person_id=person_id, job=job, year=year)
    if cached is not None:
        return cached

    credits_url = CREDITS_URL_TEMPLATE.format(id=person_id)
    try:
        res = _get_session().get(credits_url, params={"api_key": TMDB_API_KEY})
        res.raise_for_status()
    except requests.RequestException as e:
        logger.warning(f"Failed to fetch movies for person ID {person_id}. Error: {e}")
        return []
    response = res.json()

    movies: list[dict[str, Any]] = []

    if job == "Director":
        crew = response.get("crew", [])
        if isinstance(crew, list):
            movies = [
                movie
                for movie in crew
                if isinstance(movie, dict) and movie.get("job") == job
            ]
    elif job == "Actor":
        cast = response.get("cast", [])
        if isinstance(cast, list):
            movies = [movie for movie in cast if isinstance(movie, dict)]

    if year:
        allowed_years = {str(y) for y in range(year - 2, year + 3)}
        movies = [m for m in movies if m.get("release_date", "")[:4] in allowed_years]

    _memory_person_movies_set(
        person_id=person_id,
        job=job,
        year=year,
        movies=movies,
    )
    return movies


async def get_persons_movies_async(
    *,
    session: aiohttp.ClientSession,
    person_id: str,
    job: str = "Director",
    year: int | None = None,
) -> list[dict[str, Any]]:
    cached = _memory_person_movies_get(person_id=person_id, job=job, year=year)
    if cached is not None:
        return cached

    credits_url = CREDITS_URL_TEMPLATE.format(id=person_id)
    response = await _get_json_async(
        session=session,
        url=credits_url,
        params={"api_key": TMDB_API_KEY},
    )
    if response is None:
        return []

    movies: list[dict[str, Any]] = []
    if job == "Director":
        crew = response.get("crew", [])
        if isinstance(crew, list):
            movies = [
                movie
                for movie in crew
                if isinstance(movie, dict) and movie.get("job") == job
            ]
    elif job == "Actor":
        cast = response.get("cast", [])
        if isinstance(cast, list):
            movies = [movie for movie in cast if isinstance(movie, dict)]

    if year:
        allowed_years = {str(y) for y in range(year - 2, year + 3)}
        movies = [m for m in movies if m.get("release_date", "")[:4] in allowed_years]

    _memory_person_movies_set(
        person_id=person_id,
        job=job,
        year=year,
        movies=movies,
    )
    return movies


def strip_accents(text: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c)
    )


def _normalize_spaces(text: str) -> str:
    return " ".join(text.split())


def _normalize_title_search_query(title: str) -> str:
    normalized = html.unescape(title)
    normalized = normalized.replace("’", "'")
    normalized = normalized.replace("–", "-").replace("—", "-")
    return _normalize_spaces(normalized)


def _normalize_title_for_match(title: str) -> str:
    normalized = strip_accents(_normalize_title_search_query(title)).lower()
    normalized = re.sub(r"[^\w\s'-]", " ", normalized)
    return _normalize_spaces(normalized)


def _normalize_person_name(name: str) -> str | None:
    normalized = html.unescape(name)
    normalized = strip_accents(normalized)
    normalized = _normalize_spaces(normalized)
    if not normalized:
        return None
    placeholder_key = re.sub(r"[^a-z0-9]+", "", normalized.lower())
    if placeholder_key in PLACEHOLDER_PERSON_VALUES:
        return None
    return normalized


def _expand_person_names(names: Sequence[str | None]) -> list[str]:
    expanded: list[str] = []
    seen: set[str] = set()
    for raw_name in names:
        if raw_name is None:
            continue
        unescaped_name = html.unescape(raw_name)
        for part in PERSON_NAME_SPLIT_RE.split(unescaped_name):
            normalized = _normalize_person_name(part)
            if normalized is None:
                continue
            dedupe_key = normalized.lower()
            if dedupe_key in seen:
                continue
            seen.add(dedupe_key)
            expanded.append(normalized)
    return expanded


def _build_title_variants(title_query: str) -> list[str]:
    base = _normalize_title_search_query(title_query)
    if not base:
        return []
    candidates: list[str] = [base]

    without_brackets = _normalize_spaces(re.sub(r"\([^)]*\)", " ", base))
    if without_brackets and without_brackets != base:
        candidates.append(without_brackets)

    for candidate in list(candidates):
        for separator in (":", " - ", " – ", " — ", " –", " —"):
            if separator not in candidate:
                continue
            _, tail = candidate.split(separator, 1)
            tail = _normalize_spaces(tail)
            if len(tail) >= 2:
                candidates.append(tail)

    deduped: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        if not candidate:
            continue
        key = candidate.lower()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(candidate)
    return deduped


def _is_probably_non_movie_event(
    *,
    title_query: str,
    director_names: list[str],
    actor_names: list[str],
) -> bool:
    normalized_title = _normalize_title_for_match(title_query)
    if not normalized_title:
        return True

    # If concrete people metadata exists, still attempt TMDB matching.
    if director_names or actor_names:
        return False

    return any(marker in normalized_title for marker in NON_MOVIE_TITLE_MARKERS)


def _movie_id(movie: dict[str, Any]) -> int | None:
    movie_id = movie.get("id")
    if movie_id is None:
        return None
    try:
        return int(movie_id)
    except (TypeError, ValueError):
        return None


def _movie_title(movie: dict[str, Any]) -> str:
    title = movie.get("title")
    return title if isinstance(title, str) else ""


def _movie_original_title(movie: dict[str, Any]) -> str:
    original_title = movie.get("original_title")
    return original_title if isinstance(original_title, str) else ""


def _movie_popularity(movie: dict[str, Any]) -> float:
    popularity = movie.get("popularity", 0.0)
    try:
        return float(popularity)
    except (TypeError, ValueError):
        return 0.0


def _movie_release_year(movie: dict[str, Any]) -> int | None:
    release_date = movie.get("release_date")
    if not isinstance(release_date, str) or len(release_date) < 4:
        return None
    year_text = release_date[:4]
    if not year_text.isdigit():
        return None
    return int(year_text)


def _dedupe_ids(items: Sequence[str]) -> list[str]:
    return list(dict.fromkeys(str(item) for item in items))


def _dedupe_movies_by_id(movies: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped: list[dict[str, Any]] = []
    seen_ids: set[int] = set()
    for movie in movies:
        movie_id = _movie_id(movie)
        if movie_id is None:
            deduped.append(movie)
            continue
        if movie_id in seen_ids:
            continue
        seen_ids.add(movie_id)
        deduped.append(movie)
    return deduped


def _merge_candidate_movies(
    *movie_lists: Sequence[dict[str, Any]],
) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    seen_ids: set[int] = set()
    seen_object_ids: set[int] = set()
    for movie_list in movie_lists:
        for movie in movie_list:
            movie_id = _movie_id(movie)
            if movie_id is not None:
                if movie_id in seen_ids:
                    continue
                seen_ids.add(movie_id)
                merged.append(movie)
                continue
            object_id = id(movie)
            if object_id in seen_object_ids:
                continue
            seen_object_ids.add(object_id)
            merged.append(movie)
    return merged


def _title_match_score(
    *,
    title_variants: Sequence[str],
    movie: dict[str, Any],
) -> float:
    normalized_movie_title = _normalize_title_for_match(_movie_title(movie))
    normalized_movie_original_title = _normalize_title_for_match(
        _movie_original_title(movie)
    )
    best_score = 0.0
    for variant in title_variants:
        normalized_variant = _normalize_title_for_match(variant)
        if not normalized_variant:
            continue
        if normalized_movie_title:
            best_score = max(
                best_score,
                float(fuzz.token_set_ratio(normalized_variant, normalized_movie_title)),
                float(fuzz.ratio(normalized_variant, normalized_movie_title)),
            )
        if normalized_movie_original_title:
            best_score = max(
                best_score,
                float(
                    fuzz.token_set_ratio(
                        normalized_variant,
                        normalized_movie_original_title,
                    )
                ),
                float(fuzz.ratio(normalized_variant, normalized_movie_original_title)),
            )
    return best_score


def _year_score(
    *,
    query_year: int | None,
    movie: dict[str, Any],
) -> float:
    if query_year is None:
        return 0.0
    release_year = _movie_release_year(movie)
    if release_year is None:
        return 0.0
    diff = abs(release_year - query_year)
    if diff == 0:
        return 10.0
    if diff == 1:
        return 7.0
    if diff <= 2:
        return 4.0
    return -6.0


def _resolve_tmdb_id(
    *,
    title_query: str,
    title_variants: list[str],
    director_names: list[str],
    actor_names: list[str],
    potential_movies: list[dict[str, Any]],
    search_results: list[dict[str, Any]],
    directed_movie_ids: set[int],
    acted_movie_ids: set[int],
    year: int | None,
) -> int | None:
    candidates = _merge_candidate_movies(potential_movies, search_results)
    if not candidates:
        logger.debug(
            f"No TMDB candidates found for '{title_query}' with directors={director_names} actors={actor_names}."
        )
        return None

    has_director_evidence = bool(director_names) and bool(directed_movie_ids)
    has_actor_evidence = bool(actor_names) and bool(acted_movie_ids)
    lookup_variants = title_variants or [title_query]

    scored: list[tuple[float, float, float, bool, bool, dict[str, Any]]] = []
    for movie in candidates:
        movie_id = _movie_id(movie)
        director_match = (
            movie_id in directed_movie_ids if movie_id is not None else False
        )
        actor_match = movie_id in acted_movie_ids if movie_id is not None else False
        title_score = _title_match_score(title_variants=lookup_variants, movie=movie)
        metadata_bonus = 0.0
        if has_director_evidence:
            metadata_bonus += 18.0 if director_match else -6.0
        if has_actor_evidence:
            metadata_bonus += 14.0 if actor_match else -4.0
        popularity_bonus = min(_movie_popularity(movie), 100.0) / 20.0
        total_score = (
            title_score
            + metadata_bonus
            + _year_score(query_year=year, movie=movie)
            + popularity_bonus
        )
        scored.append(
            (
                total_score,
                title_score,
                _movie_popularity(movie),
                director_match,
                actor_match,
                movie,
            )
        )

    (
        best_total_score,
        best_title_score,
        _,
        best_director_match,
        best_actor_match,
        best,
    ) = max(scored, key=lambda item: (item[0], item[1], item[2]))
    strong_metadata_match = (
        (not has_director_evidence or best_director_match)
        and (not has_actor_evidence or best_actor_match)
        and (has_director_evidence or has_actor_evidence)
    )
    min_title_score = FUZZ_THRESHOLD
    if has_director_evidence or has_actor_evidence:
        min_title_score = RELAXED_FUZZ_THRESHOLD

    if best_title_score < min_title_score and not (
        strong_metadata_match and best_title_score >= STRONG_METADATA_FUZZ_THRESHOLD
    ):
        best_title = _movie_title(best) or "unknown"
        logger.debug(
            "Best TMDB candidate rejected for "
            f"'{title_query}': title={best_title}, title_score={best_title_score:.1f}, total_score={best_total_score:.1f}."
        )
        return None

    return _movie_id(best)


def _find_tmdb_id_uncached(
    *,
    title_query: str,
    title_variants: list[str],
    director_names: list[str],
    actor_names: list[str],
    year: int | None,
) -> int | None:
    if _is_probably_non_movie_event(
        title_query=title_query,
        director_names=director_names,
        actor_names=actor_names,
    ):
        logger.debug(f"Skipping TMDB lookup for likely non-film item: {title_query}")
        return None

    director_ids: list[str] = []
    directed_movies: list[dict[str, Any]] = []
    for name in director_names:
        director_ids += get_person_ids(name)
    director_ids = _dedupe_ids(director_ids)
    for person_id in director_ids:
        directed_movies += get_persons_movies(person_id, "Director", year)
    directed_movies = _dedupe_movies_by_id(directed_movies)
    directed_movie_ids = {
        movie_id
        for movie in directed_movies
        if (movie_id := _movie_id(movie)) is not None
    }

    actor_ids: list[str] = []
    for name in actor_names:
        actor_ids += get_person_ids(name)
    actor_ids = _dedupe_ids(actor_ids)

    acted_movies: list[dict[str, Any]] = []
    for actor_id in actor_ids:
        acted_movies += get_persons_movies(actor_id, "Actor", year)
    acted_movies = _dedupe_movies_by_id(acted_movies)
    acted_movie_ids = {
        movie_id for movie in acted_movies if (movie_id := _movie_id(movie)) is not None
    }

    potential_movies: list[dict[str, Any]]
    if directed_movie_ids and acted_movie_ids:
        intersected_movie_ids = directed_movie_ids & acted_movie_ids
        potential_movies = [
            movie
            for movie in _merge_candidate_movies(directed_movies, acted_movies)
            if (movie_id := _movie_id(movie)) is not None
            and movie_id in intersected_movie_ids
        ]
    elif directed_movies:
        potential_movies = directed_movies
    elif acted_movies:
        potential_movies = acted_movies
    else:
        potential_movies = []
    potential_movies = _dedupe_movies_by_id(potential_movies)

    lookup_title_variants = title_variants or [title_query]
    search_results = _search_tmdb_with_variants(lookup_title_variants)
    if not director_names and not actor_names:
        if search_results:
            best = search_results[0]
            best_id = _movie_id(best)
            best_title = _movie_title(best) or "unknown"
            if best_id is not None:
                logger.debug(
                    f"No director or actor specified, using first search result: {best_title}"
                )
                return best_id

    return _resolve_tmdb_id(
        title_query=title_query,
        title_variants=lookup_title_variants,
        director_names=director_names,
        actor_names=actor_names,
        potential_movies=potential_movies,
        search_results=search_results,
        directed_movie_ids=directed_movie_ids,
        acted_movie_ids=acted_movie_ids,
        year=year,
    )


async def _find_tmdb_id_uncached_async(
    *,
    session: aiohttp.ClientSession,
    title_query: str,
    title_variants: list[str],
    director_names: list[str],
    actor_names: list[str],
    year: int | None,
) -> int | None:
    if _is_probably_non_movie_event(
        title_query=title_query,
        director_names=director_names,
        actor_names=actor_names,
    ):
        logger.debug(f"Skipping TMDB lookup for likely non-film item: {title_query}")
        return None

    director_id_lists = await asyncio.gather(
        *(get_person_ids_async(session=session, name=name) for name in director_names),
        return_exceptions=False,
    )
    director_ids = _dedupe_ids(
        [person_id for ids in director_id_lists for person_id in ids]
    )

    directed_movie_lists = await asyncio.gather(
        *(
            get_persons_movies_async(
                session=session,
                person_id=person_id,
                job="Director",
                year=year,
            )
            for person_id in director_ids
        ),
        return_exceptions=False,
    )
    directed_movies = _dedupe_movies_by_id(
        [movie for movie_list in directed_movie_lists for movie in movie_list]
    )
    directed_movie_ids = {
        movie_id
        for movie in directed_movies
        if (movie_id := _movie_id(movie)) is not None
    }

    actor_id_lists = await asyncio.gather(
        *(get_person_ids_async(session=session, name=name) for name in actor_names),
        return_exceptions=False,
    )
    actor_ids = _dedupe_ids([person_id for ids in actor_id_lists for person_id in ids])

    acted_movie_lists = await asyncio.gather(
        *(
            get_persons_movies_async(
                session=session,
                person_id=actor_id,
                job="Actor",
                year=year,
            )
            for actor_id in actor_ids
        ),
        return_exceptions=False,
    )
    acted_movies = _dedupe_movies_by_id(
        [movie for movie_list in acted_movie_lists for movie in movie_list]
    )
    acted_movie_ids = {
        movie_id for movie in acted_movies if (movie_id := _movie_id(movie)) is not None
    }

    potential_movies: list[dict[str, Any]]
    if directed_movie_ids and acted_movie_ids:
        intersected_movie_ids = directed_movie_ids & acted_movie_ids
        potential_movies = [
            movie
            for movie in _merge_candidate_movies(directed_movies, acted_movies)
            if (movie_id := _movie_id(movie)) is not None
            and movie_id in intersected_movie_ids
        ]
    elif directed_movies:
        potential_movies = directed_movies
    elif acted_movies:
        potential_movies = acted_movies
    else:
        potential_movies = []
    potential_movies = _dedupe_movies_by_id(potential_movies)

    lookup_title_variants = title_variants or [title_query]
    search_results = await _search_tmdb_with_variants_async(
        session=session,
        title_variants=lookup_title_variants,
    )
    if not director_names and not actor_names:
        if search_results:
            best = search_results[0]
            best_id = _movie_id(best)
            best_title = _movie_title(best) or "unknown"
            if best_id is not None:
                logger.debug(
                    f"No director or actor specified, using first search result: {best_title}"
                )
                return best_id

    return _resolve_tmdb_id(
        title_query=title_query,
        title_variants=lookup_title_variants,
        director_names=director_names,
        actor_names=actor_names,
        potential_movies=potential_movies,
        search_results=search_results,
        directed_movie_ids=directed_movie_ids,
        acted_movie_ids=acted_movie_ids,
        year=year,
    )


def find_tmdb_id(
    title_query: str,
    director_names: list[str],
    actor_name: str | None = None,
    year: int | None = None,
) -> int | None:
    payload = _build_lookup_payload(
        title_query=title_query,
        director_names=director_names,
        actor_name=actor_name,
        year=year,
    )
    payload_json = _payload_to_canonical_json(payload)
    payload_hash = _payload_hash(payload_json)

    inflight_event: Event
    while True:
        memory_hit, memory_tmdb_id = _memory_lookup_cache_get(
            payload_json=payload_json,
            payload_hash=payload_hash,
        )
        if memory_hit:
            logger.debug(
                "TMDB cache hit (memory) for "
                f"title='{title_query}' hash={payload_hash[:8]} -> {memory_tmdb_id}"
            )
            _record_tmdb_lookup_event(
                payload_json=payload_json,
                tmdb_id=memory_tmdb_id,
                cache_hit=True,
                cache_source="memory",
            )
            return memory_tmdb_id

        cache_hit, cached_tmdb_id = _get_cached_tmdb_id(
            payload_json=payload_json,
            payload_hash=payload_hash,
        )
        if cache_hit:
            logger.debug(
                "TMDB cache hit (database) for "
                f"title='{title_query}' hash={payload_hash[:8]} -> {cached_tmdb_id}"
            )
            _memory_lookup_cache_set(
                payload_json=payload_json,
                payload_hash=payload_hash,
                tmdb_id=cached_tmdb_id,
            )
            _record_tmdb_lookup_event(
                payload_json=payload_json,
                tmdb_id=cached_tmdb_id,
                cache_hit=True,
                cache_source="database",
            )
            return cached_tmdb_id

        is_owner, inflight_event = _begin_inflight_lookup(
            payload_json=payload_json,
            payload_hash=payload_hash,
        )
        if is_owner:
            break

        logger.debug(
            "TMDB single-flight wait for "
            f"title='{title_query}' hash={payload_hash[:8]}"
        )
        inflight_event.wait()
        wait_hit, wait_tmdb_id = _memory_lookup_cache_get(
            payload_json=payload_json,
            payload_hash=payload_hash,
        )
        if wait_hit:
            logger.debug(
                "TMDB cache hit (singleflight) for "
                f"title='{title_query}' hash={payload_hash[:8]} -> {wait_tmdb_id}"
            )
            _record_tmdb_lookup_event(
                payload_json=payload_json,
                tmdb_id=wait_tmdb_id,
                cache_hit=True,
                cache_source="singleflight",
            )
            return wait_tmdb_id

    try:
        normalized_title_query = str(payload.get("title_query", title_query))
        normalized_title_variants = _payload_string_list(payload, "title_variants")
        normalized_directors = _payload_string_list(payload, "director_names")
        normalized_actors = _payload_string_list(payload, "actor_names")
        tmdb_id = _find_tmdb_id_uncached(
            title_query=normalized_title_query,
            title_variants=normalized_title_variants,
            director_names=normalized_directors,
            actor_names=normalized_actors,
            year=year,
        )
        _store_cached_tmdb_id(
            payload_json=payload_json,
            payload_hash=payload_hash,
            tmdb_id=tmdb_id,
        )
        _memory_lookup_cache_set(
            payload_json=payload_json,
            payload_hash=payload_hash,
            tmdb_id=tmdb_id,
        )
    finally:
        _finish_inflight_lookup(
            payload_json=payload_json,
            payload_hash=payload_hash,
            event=inflight_event,
        )

    _record_tmdb_lookup_event(
        payload_json=payload_json,
        tmdb_id=tmdb_id,
        cache_hit=False,
        cache_source="network",
    )
    logger.debug(
        "TMDB cache miss (network lookup) for "
        f"title='{title_query}' hash={payload_hash[:8]} -> {tmdb_id}"
    )
    return tmdb_id


async def find_tmdb_id_async(
    *,
    session: aiohttp.ClientSession,
    title_query: str,
    director_names: list[str],
    actor_name: str | None = None,
    year: int | None = None,
) -> int | None:
    payload = _build_lookup_payload(
        title_query=title_query,
        director_names=director_names,
        actor_name=actor_name,
        year=year,
    )
    payload_json = _payload_to_canonical_json(payload)
    payload_hash = _payload_hash(payload_json)

    inflight_event: Event
    while True:
        memory_hit, memory_tmdb_id = _memory_lookup_cache_get(
            payload_json=payload_json,
            payload_hash=payload_hash,
        )
        if memory_hit:
            logger.debug(
                "TMDB cache hit (memory) for "
                f"title='{title_query}' hash={payload_hash[:8]} -> {memory_tmdb_id}"
            )
            _record_tmdb_lookup_event(
                payload_json=payload_json,
                tmdb_id=memory_tmdb_id,
                cache_hit=True,
                cache_source="memory",
            )
            return memory_tmdb_id

        cache_hit, cached_tmdb_id = await asyncio.to_thread(
            _get_cached_tmdb_id,
            payload_json=payload_json,
            payload_hash=payload_hash,
        )
        if cache_hit:
            logger.debug(
                "TMDB cache hit (database) for "
                f"title='{title_query}' hash={payload_hash[:8]} -> {cached_tmdb_id}"
            )
            _memory_lookup_cache_set(
                payload_json=payload_json,
                tmdb_id=cached_tmdb_id,
                payload_hash=payload_hash,
            )
            _record_tmdb_lookup_event(
                payload_json=payload_json,
                tmdb_id=cached_tmdb_id,
                cache_hit=True,
                cache_source="database",
            )
            return cached_tmdb_id

        is_owner, inflight_event = _begin_inflight_lookup(
            payload_json=payload_json,
            payload_hash=payload_hash,
        )
        if is_owner:
            break

        logger.debug(
            "TMDB single-flight wait for "
            f"title='{title_query}' hash={payload_hash[:8]}"
        )
        await asyncio.to_thread(inflight_event.wait)
        wait_hit, wait_tmdb_id = _memory_lookup_cache_get(
            payload_json=payload_json,
            payload_hash=payload_hash,
        )
        if wait_hit:
            logger.debug(
                "TMDB cache hit (singleflight) for "
                f"title='{title_query}' hash={payload_hash[:8]} -> {wait_tmdb_id}"
            )
            _record_tmdb_lookup_event(
                payload_json=payload_json,
                tmdb_id=wait_tmdb_id,
                cache_hit=True,
                cache_source="singleflight",
            )
            return wait_tmdb_id

    try:
        normalized_title_query = str(payload.get("title_query", title_query))
        normalized_title_variants = _payload_string_list(payload, "title_variants")
        normalized_directors = _payload_string_list(payload, "director_names")
        normalized_actors = _payload_string_list(payload, "actor_names")
        tmdb_id = await _find_tmdb_id_uncached_async(
            session=session,
            title_query=normalized_title_query,
            title_variants=normalized_title_variants,
            director_names=normalized_directors,
            actor_names=normalized_actors,
            year=year,
        )

        await asyncio.to_thread(
            _store_cached_tmdb_id,
            payload_json=payload_json,
            payload_hash=payload_hash,
            tmdb_id=tmdb_id,
        )
        _memory_lookup_cache_set(
            payload_json=payload_json,
            payload_hash=payload_hash,
            tmdb_id=tmdb_id,
        )
    finally:
        _finish_inflight_lookup(
            payload_json=payload_json,
            payload_hash=payload_hash,
            event=inflight_event,
        )

    _record_tmdb_lookup_event(
        payload_json=payload_json,
        tmdb_id=tmdb_id,
        cache_hit=False,
        cache_source="network",
    )
    logger.debug(
        "TMDB cache miss (network lookup) for "
        f"title='{title_query}' hash={payload_hash[:8]} -> {tmdb_id}"
    )
    return tmdb_id


if __name__ == "__main__":
    # Example
    tmdb_id = find_tmdb_id(
        "Werckmeister Harmóniák",
        director_names=["Agnes Hranitzky", "Béla Tarr"],
        actor_name=None,
    )
    logger.debug(tmdb_id)
    # logger.debug()
    # print(f"letterboxd.com/tmdb/{tmdb_id}/")
    # logger.debug(search_tmdb("the-graduate")[1])
