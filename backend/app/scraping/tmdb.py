import asyncio
import hashlib
import json
import unicodedata
from collections.abc import Sequence
from threading import local
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
from app.models.tmdb_lookup_cache import TmdbLookupCache
from app.scraping.logger import logger
from app.utils import now_amsterdam_naive

TMDB_API_KEY = settings.TMDB_KEY
SEARCH_PERSON_URL = "https://api.themoviedb.org/3/search/person"
CREDITS_URL_TEMPLATE = "https://api.themoviedb.org/3/person/{id}/movie_credits"
MOVIE_URL_TEMPLATE = "https://api.themoviedb.org/3/movie/{id}"
LETTERBOXD_SEARCH_URL = "https://letterboxd.com/search/"
TMDB_SEARCH_URL = "https://api.themoviedb.org/3/search/movie"

FUZZ_THRESHOLD = 60  # Minimum score for a match
TMDB_LOOKUP_PAYLOAD_VERSION = 1

_thread_local = local()
_tmdb_cache_available: bool | None = None


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
    return {
        "version": TMDB_LOOKUP_PAYLOAD_VERSION,
        "title_query": title_query,
        "director_names": [strip_accents(name) for name in director_names],
        "actor_name": actor_name,
        "year": year,
    }


def _payload_to_canonical_json(payload: dict[str, Any]) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def _payload_hash(payload_json: str) -> str:
    return hashlib.sha256(payload_json.encode("utf-8")).hexdigest()


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


def get_person_ids(name: str) -> Sequence[str]:
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
    if not results:
        logger.warning(f"{name} could not be found on TMDB.")
        return []

    return [result["id"] for result in results]


async def get_person_ids_async(
    *,
    session: aiohttp.ClientSession,
    name: str,
) -> Sequence[str]:
    response = await _get_json_async(
        session=session,
        url=SEARCH_PERSON_URL,
        params={"api_key": TMDB_API_KEY, "query": name},
    )
    if response is None:
        return []

    results = response.get("results", [])
    if not results:
        logger.warning(f"{name} could not be found on TMDB.")
        return []

    return [result["id"] for result in results if isinstance(result, dict)]


def search_tmdb(title: str) -> list[dict[str, str]]:
    params = {
        "api_key": TMDB_API_KEY,
        "query": title,
    }

    try:
        response = requests.get(TMDB_SEARCH_URL, params=params)
        response.raise_for_status()
    except requests.RequestException as e:
        logger.warning(f"Failed to search TMDB for title '{title}'. Error: {e}")
        return []
    results: list[dict[str, str]] = response.json().get("results", [])
    return results


async def search_tmdb_async(
    *,
    session: aiohttp.ClientSession,
    title: str,
) -> list[dict[str, Any]]:
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
    return [item for item in results if isinstance(item, dict)]


def get_persons_movies(
    person_id: str, job: str = "Director", year: int | None = None
) -> list[dict[str, str]]:
    credits_url = CREDITS_URL_TEMPLATE.format(id=person_id)
    try:
        res = _get_session().get(credits_url, params={"api_key": TMDB_API_KEY})
        res.raise_for_status()
    except requests.RequestException as e:
        logger.warning(f"Failed to fetch movies for person ID {person_id}. Error: {e}")
        return []
    response = res.json()

    movies: list[dict[str, str]] = []

    if job == "Director":
        crew = response.get("crew", [])
        movies = [movie for movie in crew if movie["job"] == job]
    elif job == "Actor":
        movies = response.get("cast", [])

    if year:
        allowed_years = {str(y) for y in range(year - 2, year + 3)}
        movies = [m for m in movies if m.get("release_date", "")[:4] in allowed_years]

    return movies


async def get_persons_movies_async(
    *,
    session: aiohttp.ClientSession,
    person_id: str,
    job: str = "Director",
    year: int | None = None,
) -> list[dict[str, Any]]:
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

    return movies


def strip_accents(text: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c)
    )


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


def _resolve_tmdb_id(
    *,
    title_query: str,
    director_names: list[str],
    actor_name: str | None,
    potential_movies: list[dict[str, Any]],
    search_results: list[dict[str, Any]],
) -> int | None:
    if not potential_movies:
        logger.debug(
            f"No potential movies found for '{title_query}' with director '{director_names}' and actor '{actor_name}'."
        )
        return None

    if search_results:
        search_ids = {movie_id for m in search_results if (movie_id := _movie_id(m))}
        potential_movies_filtered = [
            m for m in potential_movies if _movie_id(m) in search_ids
        ]
        if potential_movies_filtered:
            potential_movies_filtered.sort(key=_movie_popularity)
            best = potential_movies_filtered[-1]
            return _movie_id(best)

    logger.debug(
        f"No direct match found for '{title_query}' with director '{director_names}' and actor '{actor_name}'. Fuzzy matching..."
    )
    scored = [
        (
            max(
                fuzz.token_set_ratio(title_query.lower(), _movie_title(movie).lower()),
                fuzz.token_set_ratio(
                    title_query.lower(), _movie_original_title(movie).lower()
                ),
            ),
            movie,
        )
        for movie in potential_movies
    ]
    if not scored:
        return None
    best_score, best = max(scored, key=lambda x: x[0])

    if best_score < FUZZ_THRESHOLD:
        best_title = _movie_title(best) or "unknown"
        logger.debug(
            f"Best match score ({best_title}) for '{title_query}' is below threshold: {best_score}."
        )
        return None

    return _movie_id(best)


def _find_tmdb_id_uncached(
    *,
    title_query: str,
    director_names: list[str],
    actor_name: str | None,
    year: int | None,
) -> int | None:
    director_ids: list[str] = []
    directed_movies: list[dict[str, Any]] = []
    for name in director_names:
        director_ids += get_person_ids(name)
    for person_id in director_ids:
        directed_movies += get_persons_movies(person_id, "Director", year)

    potential_movies: list[dict[str, Any]] = []
    if actor_name:
        actor_ids = get_person_ids(actor_name)
        if not actor_ids:
            potential_movies = directed_movies
        directed_movie_ids = {_movie_id(movie) for movie in directed_movies}
        for actor_id in actor_ids:
            acted_movies: list[dict[str, Any]] = get_persons_movies(
                actor_id, "Actor", year
            )
            if directed_movies:
                potential_movies += [
                    movie
                    for movie in acted_movies
                    if _movie_id(movie) in directed_movie_ids
                ]
            else:
                potential_movies += acted_movies
    else:
        potential_movies = directed_movies

    if not director_names and not actor_name:
        search_results = search_tmdb(title_query)
        if search_results:
            best = search_results[0]
            best_id = _movie_id(best)
            best_title = _movie_title(best) or "unknown"
            if best_id is not None:
                logger.debug(
                    f"No director or actor specified, using first search result: {best_title}"
                )
                return best_id

    search_results = search_tmdb(title_query)
    return _resolve_tmdb_id(
        title_query=title_query,
        director_names=director_names,
        actor_name=actor_name,
        potential_movies=potential_movies,
        search_results=search_results,
    )


async def _find_tmdb_id_uncached_async(
    *,
    session: aiohttp.ClientSession,
    title_query: str,
    director_names: list[str],
    actor_name: str | None,
    year: int | None,
) -> int | None:
    director_id_lists = await asyncio.gather(
        *(get_person_ids_async(session=session, name=name) for name in director_names),
        return_exceptions=False,
    )
    director_ids = [person_id for ids in director_id_lists for person_id in ids]

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
    directed_movies = [
        movie for movie_list in directed_movie_lists for movie in movie_list
    ]

    potential_movies: list[dict[str, Any]] = []
    if actor_name:
        actor_ids = await get_person_ids_async(session=session, name=actor_name)
        if not actor_ids:
            potential_movies = directed_movies

        directed_movie_ids = {_movie_id(movie) for movie in directed_movies}
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
        acted_movies = [movie for movie_list in acted_movie_lists for movie in movie_list]

        if directed_movies:
            potential_movies = [
                movie
                for movie in acted_movies
                if _movie_id(movie) in directed_movie_ids
            ]
        else:
            potential_movies = acted_movies
    else:
        potential_movies = directed_movies

    if not director_names and not actor_name:
        search_results = await search_tmdb_async(session=session, title=title_query)
        if search_results:
            best = search_results[0]
            best_id = _movie_id(best)
            best_title = _movie_title(best) or "unknown"
            if best_id is not None:
                logger.debug(
                    f"No director or actor specified, using first search result: {best_title}"
                )
                return best_id

    search_results = await search_tmdb_async(session=session, title=title_query)
    return _resolve_tmdb_id(
        title_query=title_query,
        director_names=director_names,
        actor_name=actor_name,
        potential_movies=potential_movies,
        search_results=search_results,
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

    cache_hit, cached_tmdb_id = _get_cached_tmdb_id(
        payload_json=payload_json,
        payload_hash=payload_hash,
    )
    if cache_hit:
        return cached_tmdb_id

    normalized_directors = payload["director_names"]
    assert isinstance(normalized_directors, list)
    tmdb_id = _find_tmdb_id_uncached(
        title_query=title_query,
        director_names=[str(name) for name in normalized_directors],
        actor_name=actor_name,
        year=year,
    )
    _store_cached_tmdb_id(
        payload_json=payload_json,
        payload_hash=payload_hash,
        tmdb_id=tmdb_id,
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

    cache_hit, cached_tmdb_id = await asyncio.to_thread(
        _get_cached_tmdb_id,
        payload_json=payload_json,
        payload_hash=payload_hash,
    )
    if cache_hit:
        return cached_tmdb_id

    normalized_directors = payload["director_names"]
    assert isinstance(normalized_directors, list)
    tmdb_id = await _find_tmdb_id_uncached_async(
        session=session,
        title_query=title_query,
        director_names=[str(name) for name in normalized_directors],
        actor_name=actor_name,
        year=year,
    )

    await asyncio.to_thread(
        _store_cached_tmdb_id,
        payload_json=payload_json,
        payload_hash=payload_hash,
        tmdb_id=tmdb_id,
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
