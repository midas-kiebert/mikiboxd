import asyncio
import hashlib
import json
import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from threading import Event, Lock, local
from typing import Any

import aiohttp
import requests
from requests.adapters import HTTPAdapter
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlmodel import select
from urllib3.util.retry import Retry

from app.api.deps import get_db_context
from app.models.tmdb_lookup_cache import TmdbLookupCache
from app.scraping import tmdb as tmdb_algorithm
from app.scraping.logger import logger
from app.scraping.tmdb_config import (
    CREDITS_URL_TEMPLATE,
    MOVIE_URL_TEMPLATE,
    SEARCH_PERSON_URL,
    TMDB_API_KEY,
    TMDB_LOOKUP_PAYLOAD_VERSION,
    TMDB_MATCH_RUNTIME_ENRICHMENT_LIMIT,
    TMDB_POSTER_BASE_URL,
    TMDB_SEARCH_URL,
    TMDB_SINGLEFLIGHT_WAIT_TIMEOUT_SECONDS,
)
from app.scraping.tmdb_normalization import (
    _build_title_variants,
    _expand_person_names,
    _is_probably_non_movie_event,
    _normalize_language_code,
    _normalize_language_codes,
    _normalize_title_search_query,
)
from app.scraping.tmdb_parsing import (
    PreEnrichmentTmdbMovieCandidate,
    dedupe_ids,
    extract_ids,
    merge_candidate_movies,
    parse_movie_candidates,
)
from app.utils import now_amsterdam_naive

TmdbMovieDetails = tmdb_algorithm.TmdbMovieDetails
TmdbLookupResult = tmdb_algorithm.TmdbLookupResult

_thread_local = local()
_tmdb_cache_available: bool | None = None
_tmdb_lookup_audit_lock = Lock()
_tmdb_lookup_audit_events: list[dict[str, Any]] = []
_lookup_result_cache_lock = Lock()
_lookup_result_cache: dict[tuple[str, str], TmdbLookupResult] = {}
_inflight_lookup_lock = Lock()
_inflight_lookup_events: dict[tuple[str, str], Event] = {}
_person_ids_cache_lock = Lock()
_person_ids_cache: dict[str, tuple[str, ...]] = {}
_person_movies_cache_lock = Lock()
_person_movies_cache: dict[tuple[str, str, int | None], list[dict[str, Any]]] = {}
_title_search_cache_lock = Lock()
_title_search_cache: dict[str, list[dict[str, Any]]] = {}
_movie_details_cache_lock = Lock()
_movie_details_cache: dict[int, TmdbMovieDetails | None] = {}


@dataclass
class ExistingTmdbResolution:
    movie_data: TmdbMovieDetails | None
    should_refetch: bool
    decision_reason: str
    age_days: float | None = None
    refresh_probability: float = 0.0


@dataclass
class TmdbLookupCacheEntry:
    lookup_hash: str
    lookup_payload: str
    tmdb_id: int | None
    confidence: float | None


def _get_session() -> requests.Session:
    """Return the thread-local requests session configured with retry behavior for TMDB calls."""
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


def build_lookup_payload(
    *,
    title_query: str,
    director_names: list[str],
    actor_name: str | None,
    year: int | None,
    duration_minutes: int | None = None,
    spoken_languages: Sequence[str] | None = None,
) -> dict[str, Any]:
    """Build the canonical lookup payload used for cache keys and deterministic TMDB matching."""
    normalized_title_query = _normalize_title_search_query(title_query)
    title_variants = _build_title_variants(normalized_title_query)
    normalized_director_names = _expand_person_names(director_names)
    normalized_actor_names = _expand_person_names([actor_name] if actor_name else [])
    normalized_spoken_languages = _normalize_language_codes(spoken_languages or [])
    return {
        "version": TMDB_LOOKUP_PAYLOAD_VERSION,
        "title_query": normalized_title_query,
        "title_variants": title_variants,
        "director_names": normalized_director_names,
        "actor_names": normalized_actor_names,
        "year": year,
        "duration_minutes": duration_minutes,
        "spoken_languages": normalized_spoken_languages,
    }


def payload_to_canonical_json(payload: dict[str, Any]) -> str:
    """Serialize a lookup payload into canonical JSON for stable hashing and cache lookups."""
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def payload_hash(payload_json: str) -> str:
    """Compute the SHA-256 hash of a canonical lookup payload JSON string."""
    return hashlib.sha256(payload_json.encode("utf-8")).hexdigest()


def _payload_string_list(payload: dict[str, Any], key: str) -> list[str]:
    """Extract a non-empty string list from a lookup payload field."""
    value = payload.get(key, [])
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if str(item).strip()]


def _payload_int(payload: dict[str, Any], key: str) -> int | None:
    """Extract an integer value from a lookup payload field when possible."""
    value = payload.get(key)
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _memory_lookup_cache_get(
    *,
    payload_json: str,
    payload_hash: str,
) -> tuple[bool, TmdbLookupResult | None]:
    """Internal TMDB helper for memory lookup cache get."""
    key = (payload_hash, payload_json)
    with _lookup_result_cache_lock:
        if key not in _lookup_result_cache:
            return False, None
        return True, _lookup_result_cache[key]


def set_memory_lookup_cache(
    *,
    payload_json: str,
    payload_hash: str,
    lookup_result: TmdbLookupResult,
) -> None:
    """Internal TMDB helper for memory lookup cache set."""
    key = (payload_hash, payload_json)
    with _lookup_result_cache_lock:
        _lookup_result_cache[key] = lookup_result


def _begin_inflight_lookup(
    *,
    payload_json: str,
    payload_hash: str,
) -> tuple[bool, Event]:
    """Register or join a single-flight lookup slot for a given normalized payload."""
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
    """Complete a single-flight lookup slot and wake any waiting threads."""
    key = (payload_hash, payload_json)
    with _inflight_lookup_lock:
        current = _inflight_lookup_events.get(key)
        if current is event:
            del _inflight_lookup_events[key]
    event.set()


def _memory_person_ids_get(name: str) -> list[str] | None:
    """Internal TMDB helper for memory person ids get."""
    with _person_ids_cache_lock:
        cached = _person_ids_cache.get(name)
    if cached is None:
        return None
    return list(cached)


def _memory_person_ids_set(name: str, person_ids: Sequence[str]) -> None:
    """Internal TMDB helper for memory person ids set."""
    with _person_ids_cache_lock:
        _person_ids_cache[name] = tuple(str(person_id) for person_id in person_ids)


def _memory_person_movies_get(
    *,
    person_id: str,
    job: str,
    year: int | None,
) -> list[dict[str, Any]] | None:
    """Internal TMDB helper for memory person movies get."""
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
    """Internal TMDB helper for memory person movies set."""
    key = (person_id, job, year)
    with _person_movies_cache_lock:
        _person_movies_cache[key] = list(movies)


def _memory_title_search_get(title: str) -> list[dict[str, Any]] | None:
    """Internal TMDB helper for memory title search get."""
    key = title.strip().lower()
    with _title_search_cache_lock:
        cached = _title_search_cache.get(key)
    if cached is None:
        return None
    return list(cached)


def _memory_title_search_set(title: str, results: list[dict[str, Any]]) -> None:
    """Internal TMDB helper for memory title search set."""
    key = title.strip().lower()
    with _title_search_cache_lock:
        _title_search_cache[key] = list(results)


def get_memory_movie_details(tmdb_id: int) -> tuple[bool, TmdbMovieDetails | None]:
    """Internal TMDB helper for memory movie details get."""
    with _movie_details_cache_lock:
        if tmdb_id not in _movie_details_cache:
            return False, None
        return True, _movie_details_cache[tmdb_id]


def set_memory_movie_details(tmdb_id: int, details: TmdbMovieDetails | None) -> None:
    """Internal TMDB helper for memory movie details set."""
    with _movie_details_cache_lock:
        _movie_details_cache[tmdb_id] = details


def _parse_tmdb_movie_details(
    payload: dict[str, Any],
    *,
    enriched_at: datetime | None,
) -> TmdbMovieDetails | None:
    """Parse a TMDB movie payload into normalized details used by matching and enrichment."""
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

    release_date = payload.get("release_date")
    release_year: int | None = None
    if (
        isinstance(release_date, str)
        and len(release_date) >= 4
        and release_date[:4].isdigit()
    ):
        release_year = int(release_date[:4])
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

    original_language = _normalize_language_code(
        payload.get("original_language")
        if isinstance(payload.get("original_language"), str)
        else None
    )
    spoken_language_values: list[str] = []
    raw_spoken_languages = payload.get("spoken_languages")
    if isinstance(raw_spoken_languages, list):
        for language in raw_spoken_languages:
            if isinstance(language, dict):
                iso_639_1 = language.get("iso_639_1")
                if isinstance(iso_639_1, str):
                    spoken_language_values.append(iso_639_1)
                english_name = language.get("english_name")
                if isinstance(english_name, str):
                    spoken_language_values.append(english_name)
                language_name = language.get("name")
                if isinstance(language_name, str):
                    spoken_language_values.append(language_name)
            elif isinstance(language, str):
                spoken_language_values.append(language)
    normalized_spoken_languages = _normalize_language_codes(spoken_language_values)
    if (
        original_language is not None
        and original_language not in normalized_spoken_languages
    ):
        normalized_spoken_languages.append(original_language)

    runtime_raw = payload.get("runtime")
    runtime_minutes: int | None = None
    if isinstance(runtime_raw, int):
        parsed_runtime = runtime_raw
    elif isinstance(runtime_raw, str):
        try:
            parsed_runtime = int(runtime_raw)
        except ValueError:
            parsed_runtime = 0
    else:
        parsed_runtime = 0
    if parsed_runtime > 0:
        runtime_minutes = parsed_runtime

    cast_names: list[str] = []
    raw_cast = credits.get("cast", []) if isinstance(credits, dict) else []
    if isinstance(raw_cast, list):
        seen_cast: set[str] = set()
        for member in raw_cast[:15]:
            if not isinstance(member, dict):
                continue
            name_raw = member.get("name")
            if not isinstance(name_raw, str):
                continue
            name = name_raw.strip()
            if not name:
                continue
            key = name.casefold()
            if key in seen_cast:
                continue
            seen_cast.add(key)
            cast_names.append(name)

    genre_ids: list[int] = []
    seen_genres: set[int] = set()
    raw_genres = payload.get("genres")
    if isinstance(raw_genres, list):
        for genre in raw_genres:
            genre_id_raw = genre.get("id") if isinstance(genre, dict) else genre
            try:
                genre_id = int(genre_id_raw)
            except (TypeError, ValueError):
                continue
            if genre_id in seen_genres:
                continue
            seen_genres.add(genre_id)
            genre_ids.append(genre_id)
    raw_genre_ids = payload.get("genre_ids")
    if isinstance(raw_genre_ids, list):
        for genre_id_raw in raw_genre_ids:
            try:
                genre_id = int(genre_id_raw)
            except (TypeError, ValueError):
                continue
            if genre_id in seen_genres:
                continue
            seen_genres.add(genre_id)
            genre_ids.append(genre_id)

    return TmdbMovieDetails(
        title=title,
        original_title=original_title,
        release_year=release_year,
        directors=directors,
        poster_url=poster_url,
        original_language=original_language,
        spoken_languages=normalized_spoken_languages or None,
        runtime_minutes=runtime_minutes,
        cast_names=cast_names or None,
        enriched_at=enriched_at,
        genre_ids=genre_ids or None,
    )


def fetch_tmdb_movie_details_sync(tmdb_id: int) -> TmdbMovieDetails | None:
    """Fetch TMDB movie details synchronously, including credits, for a candidate movie ID."""
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


async def fetch_tmdb_movie_details_async(
    *,
    session: aiohttp.ClientSession,
    tmdb_id: int,
) -> TmdbMovieDetails | None:
    """Fetch TMDB movie details asynchronously, including credits, for a candidate movie ID."""
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


def _get_cached_tmdb_id(
    *,
    payload_json: str,
    payload_hash: str,
) -> tuple[bool, TmdbLookupResult | None]:
    """Read a persisted lookup result from the database cache when available."""
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
            return True, TmdbLookupResult(
                tmdb_id=cached.tmdb_id,
                confidence=cached.confidence,
            )
    except SQLAlchemyError:
        if _tmdb_cache_available is not False:
            logger.debug("TMDB cache unavailable; falling back to uncached lookups.")
        _tmdb_cache_available = False
        return False, None


def _store_cached_tmdb_id(
    *,
    payload_json: str,
    payload_hash: str,
    lookup_result: TmdbLookupResult,
) -> None:
    """Persist a lookup result in the database cache for future TMDB ID lookups."""
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
                        tmdb_id=lookup_result.tmdb_id,
                        confidence=lookup_result.confidence,
                        created_at=now,
                        updated_at=now,
                    )
                )
            else:
                cached.tmdb_id = lookup_result.tmdb_id
                cached.confidence = lookup_result.confidence
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
    confidence: float | None,
    cache_hit: bool,
    cache_source: str | None = None,
    decision: dict[str, Any] | None = None,
) -> None:
    """Append an in-process diagnostic event describing a TMDB lookup decision."""
    try:
        payload = json.loads(payload_json)
    except json.JSONDecodeError:
        payload = {"raw_payload": payload_json}
    effective_decision = decision
    if effective_decision is None:
        effective_decision = {
            "status": "rejected" if tmdb_id is None else "accepted",
            "reason": "cached_result_without_diagnostics",
        }
    event = {
        "timestamp": now_amsterdam_naive().isoformat(),
        "payload": payload,
        "tmdb_id": tmdb_id,
        "confidence": confidence,
        "cache_hit": cache_hit,
        "decision": effective_decision,
    }
    if cache_source is not None:
        event["cache_source"] = cache_source
    with _tmdb_lookup_audit_lock:
        _tmdb_lookup_audit_events.append(event)


async def _get_json_async(
    *,
    session: aiohttp.ClientSession,
    url: str,
    params: Mapping[str, str],
) -> dict[str, Any] | None:
    """Execute an async GET request and return a validated JSON object payload."""
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


def get_person_ids(name: str) -> Sequence[str]:
    """Resolve TMDB person IDs for a name using cache-first lookup and sync HTTP fallback."""
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
    person_ids = extract_ids(results)
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
    """Resolve TMDB person IDs for a name using cache-first lookup and async HTTP fallback."""
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
    person_ids = extract_ids(results)
    if not person_ids:
        logger.warning(f"{name} could not be found on TMDB.")
        _memory_person_ids_set(name, [])
        return []

    _memory_person_ids_set(name, person_ids)
    return person_ids


def search_tmdb(title: str) -> list[dict[str, Any]]:
    """Search TMDB movie results for a title query using sync HTTP and in-memory caching."""
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
    """Search TMDB movie results for a title query using async HTTP and in-memory caching."""
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


def _search_tmdb_with_variants(
    title_variants: Sequence[str],
) -> list[PreEnrichmentTmdbMovieCandidate]:
    """Search TMDB using multiple title variants and merge deduplicated results."""
    merged_results: list[dict[str, Any]] = []
    for variant in title_variants:
        if not variant:
            continue
        merged_results.extend(search_tmdb(variant))
    return parse_movie_candidates(merged_results, source_bucket="searched")


async def _search_tmdb_with_variants_async(
    *,
    session: aiohttp.ClientSession,
    title_variants: Sequence[str],
) -> list[PreEnrichmentTmdbMovieCandidate]:
    """Async variant of variant-based TMDB title search with merged deduped output."""
    queries = [variant for variant in title_variants if variant]
    if not queries:
        return []
    result_lists = await asyncio.gather(
        *(search_tmdb_async(session=session, title=query) for query in queries),
        return_exceptions=False,
    )
    merged_results = [movie for result in result_lists for movie in result]
    return parse_movie_candidates(merged_results, source_bucket="searched")


def get_persons_movies(
    person_id: str, job: str = "Director", year: int | None = None
) -> list[dict[str, Any]]:
    """Fetch a person's TMDB movie credits for a role, optionally constrained by release year."""
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
    """Async variant for fetching a person's TMDB movie credits by role and year."""
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


def _fetch_runtime_enrichment_details_sync(
    candidate_ids: Sequence[int],
) -> dict[int, TmdbMovieDetails | None]:
    """Synchronously fetch and cache runtime-enrichment details for candidate IDs."""
    details_by_id: dict[int, TmdbMovieDetails | None] = {}
    for candidate_id in candidate_ids:
        cache_hit, cached = get_memory_movie_details(candidate_id)
        if cache_hit:
            details_by_id[candidate_id] = cached
            continue
        details = fetch_tmdb_movie_details_sync(candidate_id)
        set_memory_movie_details(candidate_id, details)
        details_by_id[candidate_id] = details
    return details_by_id


async def _fetch_runtime_enrichment_details_async(
    *,
    session: aiohttp.ClientSession,
    candidate_ids: Sequence[int],
) -> dict[int, TmdbMovieDetails | None]:
    """Asynchronously fetch and cache runtime-enrichment details for candidate IDs."""
    details_by_id: dict[int, TmdbMovieDetails | None] = {}
    missing_ids: list[int] = []
    for candidate_id in candidate_ids:
        cache_hit, cached = get_memory_movie_details(candidate_id)
        if cache_hit:
            details_by_id[candidate_id] = cached
            continue
        missing_ids.append(candidate_id)

    if missing_ids:
        fetched_details = await asyncio.gather(
            *(
                fetch_tmdb_movie_details_async(session=session, tmdb_id=candidate_id)
                for candidate_id in missing_ids
            ),
            return_exceptions=False,
        )
        for candidate_id, details in zip(missing_ids, fetched_details, strict=False):
            set_memory_movie_details(candidate_id, details)
            details_by_id[candidate_id] = details
    return details_by_id


def _find_tmdb_id_uncached(
    *,
    title_query: str,
    title_variants: list[str],
    director_names: list[str],
    actor_names: list[str],
    year: int | None,
    duration_minutes: int | None,
    spoken_languages: list[str],
) -> TmdbLookupResult:
    """Run the full synchronous TMDB lookup pipeline without cache-layer short-circuiting."""
    if _is_probably_non_movie_event(
        title_query=title_query,
        director_names=director_names,
        actor_names=actor_names,
    ):
        logger.debug(f"Skipping TMDB lookup for likely non-film item: {title_query}")
        return TmdbLookupResult(tmdb_id=None, confidence=None)

    director_ids: list[str] = []
    directed_movies_raw: list[dict[str, Any]] = []
    for name in director_names:
        director_ids += get_person_ids(name)
    director_ids = dedupe_ids(director_ids)
    for person_id in director_ids:
        directed_movies_raw += get_persons_movies(person_id, "Director", year)
    directed_movies = parse_movie_candidates(
        directed_movies_raw,
        source_bucket="directed",
    )

    actor_ids: list[str] = []
    for name in actor_names:
        actor_ids += get_person_ids(name)
    actor_ids = dedupe_ids(actor_ids)

    acted_movies_raw: list[dict[str, Any]] = []
    for actor_id in actor_ids:
        acted_movies_raw += get_persons_movies(actor_id, "Actor", year)
    acted_movies = parse_movie_candidates(
        acted_movies_raw,
        source_bucket="acted",
    )

    potential_movies = merge_candidate_movies(directed_movies, acted_movies)

    lookup_title_variants = title_variants or [title_query]
    search_results = _search_tmdb_with_variants(lookup_title_variants)
    candidate_pool = merge_candidate_movies(
        potential_movies,
        search_results,
    )

    return tmdb_algorithm.resolve_tmdb(
        title_query=title_query,
        title_variants=lookup_title_variants,
        director_names=director_names,
        actor_names=actor_names,
        candidate_pool=candidate_pool,
        year=year,
        duration_minutes=duration_minutes,
        spoken_languages=spoken_languages,
        runtime_enrichment_limit=TMDB_MATCH_RUNTIME_ENRICHMENT_LIMIT,
        fetch_runtime_details=_fetch_runtime_enrichment_details_sync,
    )


async def _find_tmdb_id_uncached_async(
    *,
    session: aiohttp.ClientSession,
    title_query: str,
    title_variants: list[str],
    director_names: list[str],
    actor_names: list[str],
    year: int | None,
    duration_minutes: int | None,
    spoken_languages: list[str],
) -> TmdbLookupResult:
    """Run the full asynchronous TMDB lookup pipeline without cache-layer short-circuiting."""
    if _is_probably_non_movie_event(
        title_query=title_query,
        director_names=director_names,
        actor_names=actor_names,
    ):
        logger.debug(f"Skipping TMDB lookup for likely non-film item: {title_query}")
        return TmdbLookupResult(tmdb_id=None, confidence=None)

    director_id_lists = await asyncio.gather(
        *(get_person_ids_async(session=session, name=name) for name in director_names),
        return_exceptions=False,
    )
    director_ids = dedupe_ids(
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
    directed_movies_raw = [
        movie for movie_list in directed_movie_lists for movie in movie_list
    ]
    directed_movies = parse_movie_candidates(
        directed_movies_raw,
        source_bucket="directed",
    )

    actor_id_lists = await asyncio.gather(
        *(get_person_ids_async(session=session, name=name) for name in actor_names),
        return_exceptions=False,
    )
    actor_ids = dedupe_ids([person_id for ids in actor_id_lists for person_id in ids])

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
    acted_movies_raw = [
        movie for movie_list in acted_movie_lists for movie in movie_list
    ]
    acted_movies = parse_movie_candidates(
        acted_movies_raw,
        source_bucket="acted",
    )

    potential_movies = merge_candidate_movies(directed_movies, acted_movies)

    lookup_title_variants = title_variants or [title_query]
    search_results = await _search_tmdb_with_variants_async(
        session=session,
        title_variants=lookup_title_variants,
    )
    candidate_pool = merge_candidate_movies(
        potential_movies,
        search_results,
    )

    async def _fetch_runtime_details(
        ids: list[int],
    ) -> dict[int, TmdbMovieDetails | None]:
        return await _fetch_runtime_enrichment_details_async(
            session=session,
            candidate_ids=ids,
        )

    return await tmdb_algorithm.resolve_tmdb_lookup_with_optional_enrichment_async(
        title_query=title_query,
        title_variants=lookup_title_variants,
        director_names=director_names,
        actor_names=actor_names,
        candidate_pool=candidate_pool,
        year=year,
        duration_minutes=duration_minutes,
        spoken_languages=spoken_languages,
        runtime_enrichment_limit=TMDB_MATCH_RUNTIME_ENRICHMENT_LIMIT,
        fetch_runtime_details=_fetch_runtime_details,
    )


def find_tmdb_id(
    title_query: str,
    director_names: list[str],
    actor_name: str | None = None,
    year: int | None = None,
    duration_minutes: int | None = None,
    spoken_languages: Sequence[str] | None = None,
) -> int | None:
    """Resolve a TMDB ID with deterministic cache keys, single-flight protection, and diagnostics."""
    payload = build_lookup_payload(
        title_query=title_query,
        director_names=director_names,
        actor_name=actor_name,
        year=year,
        duration_minutes=duration_minutes,
        spoken_languages=spoken_languages,
    )
    payload_json = payload_to_canonical_json(payload)
    lookup_hash = payload_hash(payload_json)

    inflight_event: Event
    while True:
        memory_hit, memory_lookup_result = _memory_lookup_cache_get(
            payload_json=payload_json,
            payload_hash=lookup_hash,
        )
        if memory_hit and memory_lookup_result is not None:
            logger.debug(
                "TMDB cache hit (memory) for "
                f"title='{title_query}' hash={lookup_hash[:8]} -> {memory_lookup_result.tmdb_id}"
            )
            _record_tmdb_lookup_event(
                payload_json=payload_json,
                tmdb_id=memory_lookup_result.tmdb_id,
                confidence=memory_lookup_result.confidence,
                cache_hit=True,
                cache_source="memory",
                decision=memory_lookup_result.decision,
            )
            return memory_lookup_result.tmdb_id

        cache_hit, cached_lookup_result = _get_cached_tmdb_id(
            payload_json=payload_json,
            payload_hash=lookup_hash,
        )
        if cache_hit and cached_lookup_result is not None:
            logger.debug(
                "TMDB cache hit (database) for "
                f"title='{title_query}' hash={lookup_hash[:8]} -> {cached_lookup_result.tmdb_id}"
            )
            set_memory_lookup_cache(
                payload_json=payload_json,
                payload_hash=lookup_hash,
                lookup_result=cached_lookup_result,
            )
            _record_tmdb_lookup_event(
                payload_json=payload_json,
                tmdb_id=cached_lookup_result.tmdb_id,
                confidence=cached_lookup_result.confidence,
                cache_hit=True,
                cache_source="database",
                decision=cached_lookup_result.decision,
            )
            return cached_lookup_result.tmdb_id

        is_owner, inflight_event = _begin_inflight_lookup(
            payload_json=payload_json,
            payload_hash=lookup_hash,
        )
        if is_owner:
            break

        logger.debug(
            "TMDB single-flight wait for "
            f"title='{title_query}' hash={lookup_hash[:8]}"
        )
        wait_completed = inflight_event.wait(
            timeout=TMDB_SINGLEFLIGHT_WAIT_TIMEOUT_SECONDS
        )
        if not wait_completed:
            logger.warning(
                "TMDB single-flight wait timed out for "
                "title='%s' hash=%s after %.1fs; retrying lookup ownership.",
                title_query,
                lookup_hash[:8],
                TMDB_SINGLEFLIGHT_WAIT_TIMEOUT_SECONDS,
            )
            _finish_inflight_lookup(
                payload_json=payload_json,
                payload_hash=lookup_hash,
                event=inflight_event,
            )
            continue
        wait_hit, wait_lookup_result = _memory_lookup_cache_get(
            payload_json=payload_json,
            payload_hash=lookup_hash,
        )
        if wait_hit and wait_lookup_result is not None:
            logger.debug(
                "TMDB cache hit (singleflight) for "
                f"title='{title_query}' hash={lookup_hash[:8]} -> {wait_lookup_result.tmdb_id}"
            )
            _record_tmdb_lookup_event(
                payload_json=payload_json,
                tmdb_id=wait_lookup_result.tmdb_id,
                confidence=wait_lookup_result.confidence,
                cache_hit=True,
                cache_source="singleflight",
                decision=wait_lookup_result.decision,
            )
            return wait_lookup_result.tmdb_id

    try:
        normalized_title_query = str(payload.get("title_query", title_query))
        normalized_title_variants = _payload_string_list(payload, "title_variants")
        normalized_directors = _payload_string_list(payload, "director_names")
        normalized_actors = _payload_string_list(payload, "actor_names")
        lookup_result = _find_tmdb_id_uncached(
            title_query=normalized_title_query,
            title_variants=normalized_title_variants,
            director_names=normalized_directors,
            actor_names=normalized_actors,
            year=_payload_int(payload, "year"),
            duration_minutes=_payload_int(payload, "duration_minutes"),
            spoken_languages=_payload_string_list(payload, "spoken_languages"),
        )
        _store_cached_tmdb_id(
            payload_json=payload_json,
            payload_hash=lookup_hash,
            lookup_result=lookup_result,
        )
        set_memory_lookup_cache(
            payload_json=payload_json,
            payload_hash=lookup_hash,
            lookup_result=lookup_result,
        )
    finally:
        _finish_inflight_lookup(
            payload_json=payload_json,
            payload_hash=lookup_hash,
            event=inflight_event,
        )

    _record_tmdb_lookup_event(
        payload_json=payload_json,
        tmdb_id=lookup_result.tmdb_id,
        confidence=lookup_result.confidence,
        cache_hit=False,
        cache_source="network",
        decision=lookup_result.decision,
    )
    logger.debug(
        "TMDB cache miss (network lookup) for "
        f"title='{title_query}' hash={lookup_hash[:8]} -> {lookup_result.tmdb_id} "
        f"(confidence={lookup_result.confidence})"
    )
    return lookup_result.tmdb_id


async def find_tmdb_id_async(
    *,
    session: aiohttp.ClientSession,
    title_query: str,
    director_names: list[str],
    actor_name: str | None = None,
    year: int | None = None,
    duration_minutes: int | None = None,
    spoken_languages: Sequence[str] | None = None,
) -> int | None:
    """Async TMDB ID resolver with cache checks, single-flight protection, and diagnostics."""
    payload = build_lookup_payload(
        title_query=title_query,
        director_names=director_names,
        actor_name=actor_name,
        year=year,
        duration_minutes=duration_minutes,
        spoken_languages=spoken_languages,
    )
    payload_json = payload_to_canonical_json(payload)
    lookup_hash = payload_hash(payload_json)

    inflight_event: Event
    while True:
        memory_hit, memory_lookup_result = _memory_lookup_cache_get(
            payload_json=payload_json,
            payload_hash=lookup_hash,
        )
        if memory_hit and memory_lookup_result is not None:
            logger.debug(
                "TMDB cache hit (memory) for "
                f"title='{title_query}' hash={lookup_hash[:8]} -> {memory_lookup_result.tmdb_id}"
            )
            _record_tmdb_lookup_event(
                payload_json=payload_json,
                tmdb_id=memory_lookup_result.tmdb_id,
                confidence=memory_lookup_result.confidence,
                cache_hit=True,
                cache_source="memory",
                decision=memory_lookup_result.decision,
            )
            return memory_lookup_result.tmdb_id

        cache_hit, cached_lookup_result = await asyncio.to_thread(
            _get_cached_tmdb_id,
            payload_json=payload_json,
            payload_hash=lookup_hash,
        )
        if cache_hit and cached_lookup_result is not None:
            logger.debug(
                "TMDB cache hit (database) for "
                f"title='{title_query}' hash={lookup_hash[:8]} -> {cached_lookup_result.tmdb_id}"
            )
            set_memory_lookup_cache(
                payload_json=payload_json,
                payload_hash=lookup_hash,
                lookup_result=cached_lookup_result,
            )
            _record_tmdb_lookup_event(
                payload_json=payload_json,
                tmdb_id=cached_lookup_result.tmdb_id,
                confidence=cached_lookup_result.confidence,
                cache_hit=True,
                cache_source="database",
                decision=cached_lookup_result.decision,
            )
            return cached_lookup_result.tmdb_id

        is_owner, inflight_event = _begin_inflight_lookup(
            payload_json=payload_json,
            payload_hash=lookup_hash,
        )
        if is_owner:
            break

        logger.debug(
            "TMDB single-flight wait for "
            f"title='{title_query}' hash={lookup_hash[:8]}"
        )
        wait_started = time.monotonic()
        wait_completed = False
        while (
            time.monotonic() - wait_started
        ) < TMDB_SINGLEFLIGHT_WAIT_TIMEOUT_SECONDS:
            if inflight_event.wait(timeout=0):
                wait_completed = True
                break
            await asyncio.sleep(0.05)
        if not wait_completed:
            logger.warning(
                "TMDB single-flight wait timed out for "
                "title='%s' hash=%s after %.1fs; retrying lookup ownership.",
                title_query,
                lookup_hash[:8],
                TMDB_SINGLEFLIGHT_WAIT_TIMEOUT_SECONDS,
            )
            _finish_inflight_lookup(
                payload_json=payload_json,
                payload_hash=lookup_hash,
                event=inflight_event,
            )
            continue
        wait_hit, wait_lookup_result = _memory_lookup_cache_get(
            payload_json=payload_json,
            payload_hash=lookup_hash,
        )
        if wait_hit and wait_lookup_result is not None:
            logger.debug(
                "TMDB cache hit (singleflight) for "
                f"title='{title_query}' hash={lookup_hash[:8]} -> {wait_lookup_result.tmdb_id}"
            )
            _record_tmdb_lookup_event(
                payload_json=payload_json,
                tmdb_id=wait_lookup_result.tmdb_id,
                confidence=wait_lookup_result.confidence,
                cache_hit=True,
                cache_source="singleflight",
                decision=wait_lookup_result.decision,
            )
            return wait_lookup_result.tmdb_id

    try:
        normalized_title_query = str(payload.get("title_query", title_query))
        normalized_title_variants = _payload_string_list(payload, "title_variants")
        normalized_directors = _payload_string_list(payload, "director_names")
        normalized_actors = _payload_string_list(payload, "actor_names")
        lookup_result = await _find_tmdb_id_uncached_async(
            session=session,
            title_query=normalized_title_query,
            title_variants=normalized_title_variants,
            director_names=normalized_directors,
            actor_names=normalized_actors,
            year=_payload_int(payload, "year"),
            duration_minutes=_payload_int(payload, "duration_minutes"),
            spoken_languages=_payload_string_list(payload, "spoken_languages"),
        )

        await asyncio.to_thread(
            _store_cached_tmdb_id,
            payload_json=payload_json,
            payload_hash=lookup_hash,
            lookup_result=lookup_result,
        )
        set_memory_lookup_cache(
            payload_json=payload_json,
            payload_hash=lookup_hash,
            lookup_result=lookup_result,
        )
    finally:
        _finish_inflight_lookup(
            payload_json=payload_json,
            payload_hash=lookup_hash,
            event=inflight_event,
        )

    _record_tmdb_lookup_event(
        payload_json=payload_json,
        tmdb_id=lookup_result.tmdb_id,
        confidence=lookup_result.confidence,
        cache_hit=False,
        cache_source="network",
        decision=lookup_result.decision,
    )
    logger.debug(
        "TMDB cache miss (network lookup) for "
        f"title='{title_query}' hash={lookup_hash[:8]} -> {lookup_result.tmdb_id} "
        f"(confidence={lookup_result.confidence})"
    )
    return lookup_result.tmdb_id


def set_tmdb_cache_available(value: bool | None) -> None:
    """Public setter for TMDB database-cache availability state."""
    global _tmdb_cache_available
    _tmdb_cache_available = value


def consume_tmdb_lookup_events() -> list[dict[str, Any]]:
    """Return and clear in-process TMDB lookup audit events."""
    with _tmdb_lookup_audit_lock:
        events = list(_tmdb_lookup_audit_events)
        _tmdb_lookup_audit_events.clear()
    return events


def reset_tmdb_runtime_state() -> None:
    """Clear TMDB runtime caches and wake all single-flight waiters."""
    with _lookup_result_cache_lock:
        _lookup_result_cache.clear()
    with _inflight_lookup_lock:
        waiting_events = list(_inflight_lookup_events.values())
        _inflight_lookup_events.clear()
    with _person_ids_cache_lock:
        _person_ids_cache.clear()
    with _person_movies_cache_lock:
        _person_movies_cache.clear()
    with _title_search_cache_lock:
        _title_search_cache.clear()
    with _movie_details_cache_lock:
        _movie_details_cache.clear()

    for waiting_event in waiting_events:
        waiting_event.set()

    set_tmdb_cache_available(None)
