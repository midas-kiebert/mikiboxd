import asyncio
import json
import os
import random
import time
from dataclasses import dataclass
from datetime import datetime
from threading import BoundedSemaphore, Event, Lock
from typing import Any
from urllib.parse import urlparse

import aiohttp
import requests
from bs4 import BeautifulSoup, Tag
from pydantic import BaseModel
from requests import Response

from app.api.deps import get_db_context
from app.crud import movie as movies_crud
from app.exceptions import scraper_exceptions
from app.models.movie import Movie
from app.scraping.logger import logger
from app.utils import now_amsterdam_naive

HEADERS = {
    "referer": "https://letterboxd.com",
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
    "user-agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/133.0.0.0 Safari/537.36"
    ),
}


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return max(1, int(raw))
    except ValueError:
        return default


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


LETTERBOXD_HTTP_CONCURRENCY = _env_int("LETTERBOXD_HTTP_CONCURRENCY", 2)
LETTERBOXD_HTTP_RETRIES = _env_int("LETTERBOXD_HTTP_RETRIES", 2)
LETTERBOXD_HTTP_BACKOFF_SECONDS = _env_float("LETTERBOXD_HTTP_BACKOFF_SECONDS", 0.4)
LETTERBOXD_MIN_REQUEST_INTERVAL_SECONDS = _env_float(
    "LETTERBOXD_MIN_REQUEST_INTERVAL_SECONDS",
    1.0,
)
LETTERBOXD_REQUEST_TIMEOUT_SECONDS = _env_float(
    "LETTERBOXD_REQUEST_TIMEOUT_SECONDS",
    20.0,
)
LETTERBOXD_CF_BLOCK_SECONDS = _env_float("LETTERBOXD_CF_BLOCK_SECONDS", 900.0)
LETTERBOXD_REFRESH_AFTER_DAYS = _env_non_negative_int(
    "LETTERBOXD_REFRESH_AFTER_DAYS",
    5,
)
# Backwards-compatible fallback for existing env configuration.
LETTERBOXD_STALE_REFRESH_PROBABILITY = _env_probability(
    "LETTERBOXD_STALE_REFRESH_PROBABILITY",
    0.03,
)
LETTERBOXD_STALE_REFRESH_BASE_PROBABILITY = _env_probability(
    "LETTERBOXD_STALE_REFRESH_BASE_PROBABILITY",
    LETTERBOXD_STALE_REFRESH_PROBABILITY,
)
LETTERBOXD_STALE_REFRESH_DAILY_INCREASE = _env_float(
    "LETTERBOXD_STALE_REFRESH_DAILY_INCREASE",
    0.01,
)
LETTERBOXD_STALE_REFRESH_MAX_PROBABILITY = _env_probability(
    "LETTERBOXD_STALE_REFRESH_MAX_PROBABILITY",
    1.0,
)
_letterboxd_http_sync_semaphore = BoundedSemaphore(LETTERBOXD_HTTP_CONCURRENCY)
_letterboxd_http_async_semaphore = asyncio.Semaphore(LETTERBOXD_HTTP_CONCURRENCY)
_letterboxd_rate_limit_lock = Lock()
_letterboxd_next_request_at: float = 0.0
_letterboxd_challenge_block_lock = Lock()
_letterboxd_challenge_block_until: float = 0.0
_letterboxd_challenge_logged_until: float = 0.0
_letterboxd_challenge_reason: str | None = None
_letterboxd_failure_audit_lock = Lock()
_letterboxd_failure_audit_events: list[dict[str, Any]] = []

_letterboxd_cache_lock = Lock()
_letterboxd_cache: dict[int, "LetterboxdMovieData | None"] = {}
_letterboxd_inflight_lock = Lock()
_letterboxd_inflight: dict[int, Event] = {}


@dataclass(frozen=True)
class AsyncPageResponse:
    url: str
    text: str


@dataclass(frozen=True)
class SyncPageFetchResult:
    response: Response | None
    status_code: int | None
    not_found: bool = False
    blocked: bool = False


@dataclass(frozen=True)
class AsyncPageFetchResult:
    response: AsyncPageResponse | None
    status_code: int | None
    not_found: bool = False
    blocked: bool = False


class LetterboxdMovieData(BaseModel):
    slug: str
    poster_url: str | None
    title: str
    original_title: str | None
    release_year: int | None
    directors: list[str]
    rating: float | None = None
    top250: int | None = None
    enriched_at: datetime | None = None


@dataclass(frozen=True)
class ExistingMovieResolution:
    movie_data: LetterboxdMovieData | None
    should_refetch: bool


def _movie_to_letterboxd_data(movie: Movie) -> LetterboxdMovieData | None:
    if not movie.letterboxd_slug:
        return None
    return LetterboxdMovieData(
        slug=movie.letterboxd_slug,
        poster_url=movie.poster_link,
        title=movie.title,
        original_title=movie.original_title,
        release_year=movie.release_year,
        directors=movie.directors or [],
        rating=movie.rating,
        top250=movie.top250,
        enriched_at=movie.letterboxd_last_enriched_at,
    )


def _load_existing_movie(tmdb_id: int) -> Movie | None:
    with get_db_context() as session:
        return movies_crud.get_movie_by_id(session=session, id=tmdb_id)


def _age_days(movie: Movie, now: datetime) -> float | None:
    enriched_at = movie.letterboxd_last_enriched_at
    if enriched_at is None:
        return None
    return max(0.0, (now - enriched_at).total_seconds() / 86400.0)


def _stale_refresh_probability(age_days: float | None) -> float:
    if age_days is None:
        # Unknown age; keep load low but still allow eventual refresh.
        return LETTERBOXD_STALE_REFRESH_BASE_PROBABILITY
    if age_days < LETTERBOXD_REFRESH_AFTER_DAYS:
        return 0.0

    days_over_threshold = age_days - float(LETTERBOXD_REFRESH_AFTER_DAYS)
    probability = (
        LETTERBOXD_STALE_REFRESH_BASE_PROBABILITY
        + days_over_threshold * LETTERBOXD_STALE_REFRESH_DAILY_INCREASE
    )
    return min(
        LETTERBOXD_STALE_REFRESH_MAX_PROBABILITY,
        max(0.0, probability),
    )


def _resolve_existing_movie(tmdb_id: int) -> ExistingMovieResolution:
    movie = _load_existing_movie(tmdb_id)
    if movie is None:
        return ExistingMovieResolution(movie_data=None, should_refetch=True)

    existing_data = _movie_to_letterboxd_data(movie)
    if existing_data is None:
        # No Letterboxd slug stored yet; try network fetch.
        return ExistingMovieResolution(movie_data=None, should_refetch=True)

    age_days = _age_days(movie, now_amsterdam_naive())
    refresh_probability = _stale_refresh_probability(age_days)
    if refresh_probability <= 0.0:
        return ExistingMovieResolution(
            movie_data=existing_data,
            should_refetch=False,
        )

    should_refetch = random.random() < refresh_probability
    return ExistingMovieResolution(
        movie_data=existing_data,
        should_refetch=should_refetch,
    )


def _cache_get(tmdb_id: int) -> tuple[bool, LetterboxdMovieData | None]:
    with _letterboxd_cache_lock:
        if tmdb_id not in _letterboxd_cache:
            return False, None
        return True, _letterboxd_cache[tmdb_id]


def _cache_set(tmdb_id: int, value: LetterboxdMovieData | None) -> None:
    with _letterboxd_cache_lock:
        _letterboxd_cache[tmdb_id] = value


def _begin_inflight(tmdb_id: int) -> tuple[bool, Event]:
    with _letterboxd_inflight_lock:
        existing = _letterboxd_inflight.get(tmdb_id)
        if existing is not None:
            return False, existing
        event = Event()
        _letterboxd_inflight[tmdb_id] = event
        return True, event


def _finish_inflight(tmdb_id: int, event: Event) -> None:
    with _letterboxd_inflight_lock:
        current = _letterboxd_inflight.get(tmdb_id)
        if current is event:
            del _letterboxd_inflight[tmdb_id]
    event.set()


def _is_retryable_status(status: int) -> bool:
    return status in {408, 425, 500, 502, 503, 504}


def _retry_delay(attempt: int) -> float:
    jitter = random.uniform(0.0, 0.25)
    return LETTERBOXD_HTTP_BACKOFF_SECONDS * (2**attempt) + jitter


def _record_letterboxd_failure_event(
    *,
    event_type: str,
    url: str | None = None,
    tmdb_id: int | None = None,
    status_code: int | None = None,
    reason: str | None = None,
    block_remaining_seconds: float | None = None,
) -> None:
    event: dict[str, Any] = {
        "timestamp": f"{datetime.utcnow().isoformat()}Z",
        "event_type": event_type,
    }
    if url is not None:
        event["url"] = url
    if tmdb_id is not None:
        event["tmdb_id"] = tmdb_id
    if status_code is not None:
        event["status_code"] = status_code
    if reason is not None:
        event["reason"] = reason
    if block_remaining_seconds is not None:
        event["block_remaining_seconds"] = round(max(0.0, block_remaining_seconds), 2)

    with _letterboxd_failure_audit_lock:
        _letterboxd_failure_audit_events.append(event)


def consume_letterboxd_failure_events() -> list[dict[str, Any]]:
    with _letterboxd_failure_audit_lock:
        events = list(_letterboxd_failure_audit_events)
        _letterboxd_failure_audit_events.clear()
    return events


def _extract_tmdb_id_from_url(url: str | None) -> int | None:
    if not url:
        return None
    parts = [part for part in urlparse(url).path.split("/") if part]
    if len(parts) < 2:
        return None
    if parts[0] != "tmdb":
        return None
    try:
        return int(parts[1])
    except ValueError:
        return None


def _take_rate_limit_slot() -> float:
    global _letterboxd_next_request_at
    if LETTERBOXD_MIN_REQUEST_INTERVAL_SECONDS <= 0:
        return 0.0
    with _letterboxd_rate_limit_lock:
        now = time.monotonic()
        wait_for = max(0.0, _letterboxd_next_request_at - now)
        scheduled_at = now + wait_for
        _letterboxd_next_request_at = (
            scheduled_at + LETTERBOXD_MIN_REQUEST_INTERVAL_SECONDS
        )
    return wait_for


def _wait_for_rate_limit_sync() -> None:
    wait_for = _take_rate_limit_slot()
    if wait_for > 0:
        time.sleep(wait_for)


async def _wait_for_rate_limit_async() -> None:
    wait_for = _take_rate_limit_slot()
    if wait_for > 0:
        await asyncio.sleep(wait_for)


def _set_challenge_block(
    *,
    reason: str,
    url: str | None = None,
    status_code: int | None = None,
) -> None:
    global _letterboxd_challenge_block_until
    global _letterboxd_challenge_logged_until
    global _letterboxd_challenge_reason
    now = time.monotonic()
    block_until = now + LETTERBOXD_CF_BLOCK_SECONDS
    block_remaining_seconds = LETTERBOXD_CF_BLOCK_SECONDS
    should_log = False
    with _letterboxd_challenge_block_lock:
        if block_until > _letterboxd_challenge_block_until:
            _letterboxd_challenge_block_until = block_until
        _letterboxd_challenge_reason = reason
        block_remaining_seconds = max(0.0, _letterboxd_challenge_block_until - now)
        if now >= _letterboxd_challenge_logged_until:
            _letterboxd_challenge_logged_until = _letterboxd_challenge_block_until
            should_log = True

    if should_log:
        if reason == "cloudflare_challenge":
            logger.warning(
                "Letterboxd returned Cloudflare challenge; suppressing Letterboxd HTTP "
                f"calls for {LETTERBOXD_CF_BLOCK_SECONDS:.0f}s."
            )
        else:
            logger.warning(
                "Letterboxd temporarily rate-limited; suppressing Letterboxd HTTP "
                f"calls for {LETTERBOXD_CF_BLOCK_SECONDS:.0f}s."
            )

    _record_letterboxd_failure_event(
        event_type=reason,
        url=url,
        tmdb_id=_extract_tmdb_id_from_url(url),
        status_code=status_code,
        reason=reason,
        block_remaining_seconds=block_remaining_seconds,
    )


def _challenge_block_active() -> bool:
    with _letterboxd_challenge_block_lock:
        return time.monotonic() < _letterboxd_challenge_block_until


def _challenge_block_remaining_seconds() -> float:
    with _letterboxd_challenge_block_lock:
        return max(0.0, _letterboxd_challenge_block_until - time.monotonic())


def _challenge_block_reason() -> str | None:
    with _letterboxd_challenge_block_lock:
        return _letterboxd_challenge_reason


def is_letterboxd_temporarily_blocked() -> bool:
    return _challenge_block_active()


def _is_cloudflare_challenge(headers: Any) -> bool:
    raw_value = None
    if hasattr(headers, "get"):
        raw_value = headers.get("cf-mitigated")
    value = str(raw_value) if raw_value is not None else ""
    return value.lower() == "challenge"


def _is_cloudflare_challenge_text(text: str) -> bool:
    lowered = text.lower()
    return "cf-challenge" in lowered or (
        "cloudflare" in lowered
        and (
            "attention required" in lowered
            or "just a moment" in lowered
            or "verify you are human" in lowered
            or "please enable javascript" in lowered
        )
    )


def _fetch_page(url: str) -> SyncPageFetchResult:
    if _challenge_block_active():
        logger.debug(f"Skipping Letterboxd call during challenge cooldown: {url}")
        _record_letterboxd_failure_event(
            event_type="cooldown_skip",
            url=url,
            tmdb_id=_extract_tmdb_id_from_url(url),
            reason=_challenge_block_reason() or "cooldown_active",
            block_remaining_seconds=_challenge_block_remaining_seconds(),
        )
        return SyncPageFetchResult(
            response=None,
            status_code=None,
            blocked=True,
        )

    attempts = LETTERBOXD_HTTP_RETRIES + 1
    for attempt in range(attempts):
        try:
            with _letterboxd_http_sync_semaphore:
                _wait_for_rate_limit_sync()
                response = requests.get(
                    url,
                    headers=HEADERS,
                    allow_redirects=True,
                    timeout=LETTERBOXD_REQUEST_TIMEOUT_SECONDS,
                )
        except requests.RequestException as e:
            if attempt < attempts - 1:
                delay = _retry_delay(attempt)
                logger.debug(
                    f"Retrying Letterboxd page {url} after request error ({type(e).__name__}): {delay:.2f}s"
                )
                time.sleep(delay)
                continue
            logger.warning(f"Failed to load page {url}. Error: {e}")
            _record_letterboxd_failure_event(
                event_type="request_error",
                url=url,
                tmdb_id=_extract_tmdb_id_from_url(url),
                reason=f"{type(e).__name__}: {e}",
            )
            return SyncPageFetchResult(response=None, status_code=None)

        if response.status_code == 200:
            return SyncPageFetchResult(response=response, status_code=200)

        if response.status_code == 404:
            _record_letterboxd_failure_event(
                event_type="not_found",
                url=url,
                tmdb_id=_extract_tmdb_id_from_url(url),
                status_code=404,
                reason="http_404",
            )
            return SyncPageFetchResult(
                response=None,
                status_code=404,
                not_found=True,
            )

        if response.status_code == 403 and (
            _is_cloudflare_challenge(response.headers)
            or _is_cloudflare_challenge_text(response.text)
        ):
            _set_challenge_block(
                reason="cloudflare_challenge",
                url=url,
                status_code=403,
            )
            return SyncPageFetchResult(
                response=None,
                status_code=403,
                blocked=True,
            )

        if response.status_code == 429:
            _set_challenge_block(
                reason="rate_limited",
                url=url,
                status_code=429,
            )
            return SyncPageFetchResult(
                response=None,
                status_code=429,
                blocked=True,
            )

        if _is_retryable_status(response.status_code) and attempt < attempts - 1:
            delay = _retry_delay(attempt)
            logger.debug(
                f"Retrying Letterboxd page {url} after status {response.status_code}: {delay:.2f}s"
            )
            time.sleep(delay)
            continue

        logger.warning(
            f"Failed to load page {url}. Status code: {response.status_code}"
        )
        _record_letterboxd_failure_event(
            event_type="http_error",
            url=url,
            tmdb_id=_extract_tmdb_id_from_url(url),
            status_code=response.status_code,
            reason=f"http_{response.status_code}",
        )
        return SyncPageFetchResult(response=None, status_code=response.status_code)

    return SyncPageFetchResult(response=None, status_code=None)


def get_page(url: str) -> Response | None:
    return _fetch_page(url).response


async def _fetch_page_async(
    *,
    session: aiohttp.ClientSession,
    url: str,
) -> AsyncPageFetchResult:
    if _challenge_block_active():
        logger.debug(f"Skipping Letterboxd call during challenge cooldown: {url}")
        _record_letterboxd_failure_event(
            event_type="cooldown_skip",
            url=url,
            tmdb_id=_extract_tmdb_id_from_url(url),
            reason=_challenge_block_reason() or "cooldown_active",
            block_remaining_seconds=_challenge_block_remaining_seconds(),
        )
        return AsyncPageFetchResult(
            response=None,
            status_code=None,
            blocked=True,
        )

    attempts = LETTERBOXD_HTTP_RETRIES + 1
    for attempt in range(attempts):
        try:
            async with _letterboxd_http_async_semaphore:
                await _wait_for_rate_limit_async()
                async with session.get(
                    url,
                    headers=HEADERS,
                    allow_redirects=True,
                ) as response:
                    text = await response.text()
                    if response.status == 200:
                        return AsyncPageFetchResult(
                            response=AsyncPageResponse(
                                url=str(response.url), text=text
                            ),
                            status_code=200,
                        )
                    if response.status == 404:
                        _record_letterboxd_failure_event(
                            event_type="not_found",
                            url=url,
                            tmdb_id=_extract_tmdb_id_from_url(url),
                            status_code=404,
                            reason="http_404",
                        )
                        return AsyncPageFetchResult(
                            response=None,
                            status_code=404,
                            not_found=True,
                        )
                    if response.status == 403 and (
                        _is_cloudflare_challenge(dict(response.headers))
                        or _is_cloudflare_challenge_text(text)
                    ):
                        _set_challenge_block(
                            reason="cloudflare_challenge",
                            url=url,
                            status_code=403,
                        )
                        return AsyncPageFetchResult(
                            response=None,
                            status_code=403,
                            blocked=True,
                        )
                    if response.status == 429:
                        _set_challenge_block(
                            reason="rate_limited",
                            url=url,
                            status_code=429,
                        )
                        return AsyncPageFetchResult(
                            response=None,
                            status_code=429,
                            blocked=True,
                        )
                    if _is_retryable_status(response.status) and attempt < attempts - 1:
                        delay = _retry_delay(attempt)
                        logger.debug(
                            f"Retrying Letterboxd page {url} after status {response.status}: {delay:.2f}s"
                        )
                        await asyncio.sleep(delay)
                        continue
                    logger.warning(
                        f"Failed to fetch page {url}. Status code: {response.status}"
                    )
                    _record_letterboxd_failure_event(
                        event_type="http_error",
                        url=url,
                        tmdb_id=_extract_tmdb_id_from_url(url),
                        status_code=response.status,
                        reason=f"http_{response.status}",
                    )
                    return AsyncPageFetchResult(
                        response=None,
                        status_code=response.status,
                    )
        except (aiohttp.ClientError, asyncio.TimeoutError) as e:
            if attempt < attempts - 1:
                delay = _retry_delay(attempt)
                logger.debug(
                    f"Retrying Letterboxd page {url} after request error ({type(e).__name__}): {delay:.2f}s"
                )
                await asyncio.sleep(delay)
                continue
            logger.warning(f"Failed to load page {url}. Error: {e}")
            _record_letterboxd_failure_event(
                event_type="request_error",
                url=url,
                tmdb_id=_extract_tmdb_id_from_url(url),
                reason=f"{type(e).__name__}: {e}",
            )
            return AsyncPageFetchResult(response=None, status_code=None)

    return AsyncPageFetchResult(response=None, status_code=None)


async def get_page_async(
    *,
    session: aiohttp.ClientSession,
    url: str,
) -> AsyncPageResponse | None:
    return (await _fetch_page_async(session=session, url=url)).response


def get_letterboxd_page(tmdb_id: int) -> SyncPageFetchResult:
    url = f"https://letterboxd.com/tmdb/{tmdb_id}/"
    return _fetch_page(url)


async def get_letterboxd_page_async(
    *,
    session: aiohttp.ClientSession,
    tmdb_id: int,
) -> AsyncPageFetchResult:
    url = f"https://letterboxd.com/tmdb/{tmdb_id}/"
    return await _fetch_page_async(session=session, url=url)


def parse_page(response: Response) -> BeautifulSoup:
    return BeautifulSoup(response.text, "lxml")


def parse_page_text(text: str) -> BeautifulSoup:
    return BeautifulSoup(text, "lxml")


def get_slug(response: Response) -> str:
    final_url = response.url
    slug = final_url.split("/")[-2]
    return slug


def get_slug_from_url(url: str) -> str | None:
    url_parts = [part for part in urlparse(url).path.split("/") if part]
    if not url_parts:
        return None
    return url_parts[-1]


def get_poster_url(slug: str) -> str | None:
    url = f"https://letterboxd.com/film/{slug}/poster/std/230/"
    response = get_page(url)
    if response is None:
        return None
    json = response.json()
    if not isinstance(json, dict):
        raise scraper_exceptions.ScraperStructureError()
    return json.get("url")


async def get_poster_url_async(
    *,
    session: aiohttp.ClientSession,
    slug: str,
) -> str | None:
    url = f"https://letterboxd.com/film/{slug}/poster/std/230/"
    response = await get_page_async(session=session, url=url)
    if response is None:
        return None

    try:
        payload = json.loads(response.text)
    except json.JSONDecodeError as e:
        logger.warning(f"Invalid poster payload for {url}. Error: {e}")
        return None

    if not isinstance(payload, dict):
        raise scraper_exceptions.ScraperStructureError()
    poster_url = payload.get("url")
    return poster_url if isinstance(poster_url, str) else None


def get_english_title(page: BeautifulSoup) -> str:
    title_tag = page.find("h1", class_="primaryname")
    if not isinstance(title_tag, Tag):
        raise scraper_exceptions.ScraperStructureError()
    span = title_tag.find("span", class_="name")
    if not isinstance(span, Tag):
        raise scraper_exceptions.ScraperStructureError()
    title_text = span.text
    if not isinstance(title_text, str):
        raise scraper_exceptions.ScraperStructureError()
    return title_text.strip()


def get_original_title(page: BeautifulSoup) -> str | None:
    original_title_tag = page.find("h2", class_="originalname")
    if not original_title_tag:
        return None
    if not isinstance(original_title_tag, Tag):
        raise scraper_exceptions.ScraperStructureError()
    em = original_title_tag.find("em")
    if not isinstance(em, Tag):
        raise scraper_exceptions.ScraperStructureError()
    original_title_text = em.text
    if not isinstance(original_title_text, str):
        raise scraper_exceptions.ScraperStructureError()
    return original_title_text.strip()


def get_year(page: BeautifulSoup) -> int | None:
    year_tag = page.find("span", class_="releasedate")
    if year_tag is None:
        return None
    if not isinstance(year_tag, Tag):
        raise scraper_exceptions.ScraperStructureError()
    a = year_tag.find("a")
    if not isinstance(a, Tag):
        raise scraper_exceptions.ScraperStructureError()
    year_text = a.text
    if not isinstance(year_text, str):
        raise scraper_exceptions.ScraperStructureError()
    year = int(year_text.strip())
    return year


def get_directors(page: BeautifulSoup) -> list[str]:
    creator_list = page.find("span", class_="creatorlist")
    if not creator_list:
        return []
    if not isinstance(creator_list, Tag):
        raise scraper_exceptions.ScraperStructureError()
    contributors = creator_list.find_all("a", class_="contributor")
    directors = []
    for contributor in contributors:
        if not isinstance(contributor, Tag):
            raise scraper_exceptions.ScraperStructureError()
        span = contributor.find("span")
        if not isinstance(span, Tag):
            raise scraper_exceptions.ScraperStructureError()
        name = span.text
        if not isinstance(name, str):
            raise scraper_exceptions.ScraperStructureError()
        directors.append(name.strip())
    return directors


def get_rating(slug: str) -> float | None:
    url = f"https://letterboxd.com/csi/film/{slug}/ratings-summary/"
    response = get_page(url)
    if response is None:
        return None
    page = BeautifulSoup(response.text, "lxml")
    rating_tag = page.find("a", class_="display-rating")
    if not isinstance(rating_tag, Tag):
        return None
    rating_text = rating_tag.text
    if not isinstance(rating_text, str):
        raise scraper_exceptions.ScraperStructureError()
    rating = float(rating_text.strip())
    return rating


async def get_rating_async(
    *,
    session: aiohttp.ClientSession,
    slug: str,
) -> float | None:
    url = f"https://letterboxd.com/csi/film/{slug}/ratings-summary/"
    response = await get_page_async(session=session, url=url)
    if response is None:
        return None
    page = BeautifulSoup(response.text, "lxml")
    rating_tag = page.find("a", class_="display-rating")
    if not isinstance(rating_tag, Tag):
        return None
    rating_text = rating_tag.text
    if not isinstance(rating_text, str):
        raise scraper_exceptions.ScraperStructureError()
    return float(rating_text.strip())


def get_top250_position(slug: str) -> int | None:
    url = f"https://letterboxd.com/csi/film/{slug}/stats/"
    response = get_page(url)
    if response is None:
        return None
    page = BeautifulSoup(response.text, "lxml")
    position_tag = page.find("div", class_="-top250")
    if not isinstance(position_tag, Tag):
        return None
    a = position_tag.find("a")
    if not isinstance(a, Tag):
        raise scraper_exceptions.ScraperStructureError()
    span = a.find("span")
    if not isinstance(span, Tag):
        raise scraper_exceptions.ScraperStructureError()
    position_text = span.text
    if not isinstance(position_text, str):
        raise scraper_exceptions.ScraperStructureError()
    position = int(position_text.strip())
    return position


async def get_top250_position_async(
    *,
    session: aiohttp.ClientSession,
    slug: str,
) -> int | None:
    url = f"https://letterboxd.com/csi/film/{slug}/stats/"
    response = await get_page_async(session=session, url=url)
    if response is None:
        return None
    page = BeautifulSoup(response.text, "lxml")
    position_tag = page.find("div", class_="-top250")
    if not isinstance(position_tag, Tag):
        return None
    a = position_tag.find("a")
    if not isinstance(a, Tag):
        raise scraper_exceptions.ScraperStructureError()
    span = a.find("span")
    if not isinstance(span, Tag):
        raise scraper_exceptions.ScraperStructureError()
    position_text = span.text
    if not isinstance(position_text, str):
        raise scraper_exceptions.ScraperStructureError()
    return int(position_text.strip())


def film_not_found(response: Response) -> bool:
    page = BeautifulSoup(response.text, "lxml")
    not_found_tag = page.find("h1", class_="title")
    if not isinstance(not_found_tag, Tag):
        return False
    return not_found_tag.text == "Film not found"


def film_not_found_text(text: str) -> bool:
    page = BeautifulSoup(text, "lxml")
    not_found_tag = page.find("h1", class_="title")
    if not isinstance(not_found_tag, Tag):
        return False
    return not_found_tag.text == "Film not found"


def scrape_letterboxd(tmdb_id: int) -> LetterboxdMovieData | None:
    inflight_event: Event
    while True:
        cache_hit, cached = _cache_get(tmdb_id)
        if cache_hit:
            logger.debug(f"Letterboxd cache hit for TMDB ID {tmdb_id}")
            return cached
        is_owner, inflight_event = _begin_inflight(tmdb_id)
        if is_owner:
            break
        logger.debug(f"Letterboxd single-flight wait for TMDB ID {tmdb_id}")
        inflight_event.wait()

    try:
        existing_resolution = _resolve_existing_movie(tmdb_id)
        if (
            existing_resolution.movie_data is not None
            and not existing_resolution.should_refetch
        ):
            _cache_set(tmdb_id, existing_resolution.movie_data)
            return existing_resolution.movie_data

        fetch_result = get_letterboxd_page(tmdb_id)
        if fetch_result.response is None:
            if fetch_result.not_found:
                if existing_resolution.movie_data is not None:
                    _cache_set(tmdb_id, existing_resolution.movie_data)
                    return existing_resolution.movie_data
                _cache_set(tmdb_id, None)
                return None
            if existing_resolution.movie_data is not None:
                _cache_set(tmdb_id, existing_resolution.movie_data)
                return existing_resolution.movie_data
            return None

        response = fetch_result.response
        slug = get_slug(response)
        if slug is None:
            _record_letterboxd_failure_event(
                event_type="slug_parse_failed",
                tmdb_id=tmdb_id,
                url=str(response.url),
                reason="missing_slug",
            )
            if existing_resolution.movie_data is not None:
                _cache_set(tmdb_id, existing_resolution.movie_data)
                return existing_resolution.movie_data
            return None

        parsed_page = parse_page(response)
        if film_not_found(response):
            logger.warning(f"Letterboxd page not found for TMDB ID {tmdb_id}")
            _record_letterboxd_failure_event(
                event_type="film_not_found_marker",
                tmdb_id=tmdb_id,
                url=str(response.url),
                reason="film_not_found_marker",
            )
            if existing_resolution.movie_data is not None:
                _cache_set(tmdb_id, existing_resolution.movie_data)
                return existing_resolution.movie_data
            _cache_set(tmdb_id, None)
            return None

        poster_url = get_poster_url(slug)
        title = get_english_title(parsed_page)
        original_title = get_original_title(parsed_page)
        release_year = get_year(parsed_page)
        directors = get_directors(parsed_page)
        rating = get_rating(slug)
        top250 = get_top250_position(slug)
        result = LetterboxdMovieData(
            slug=slug,
            poster_url=poster_url,
            title=title,
            original_title=original_title,
            release_year=release_year,
            directors=directors,
            rating=rating,
            top250=top250,
            enriched_at=now_amsterdam_naive(),
        )
        _cache_set(tmdb_id, result)
        return result
    finally:
        _finish_inflight(tmdb_id, inflight_event)


async def scrape_letterboxd_async(
    *,
    tmdb_id: int,
    session: aiohttp.ClientSession | None = None,
) -> LetterboxdMovieData | None:
    inflight_event: Event
    while True:
        cache_hit, cached = _cache_get(tmdb_id)
        if cache_hit:
            logger.debug(f"Letterboxd cache hit for TMDB ID {tmdb_id}")
            return cached
        is_owner, inflight_event = _begin_inflight(tmdb_id)
        if is_owner:
            break
        logger.debug(f"Letterboxd single-flight wait for TMDB ID {tmdb_id}")
        await asyncio.to_thread(inflight_event.wait)

    local_session = session
    close_session = local_session is None
    try:
        existing_resolution = await asyncio.to_thread(_resolve_existing_movie, tmdb_id)
        if (
            existing_resolution.movie_data is not None
            and not existing_resolution.should_refetch
        ):
            _cache_set(tmdb_id, existing_resolution.movie_data)
            return existing_resolution.movie_data

        if close_session:
            local_session = aiohttp.ClientSession(
                timeout=aiohttp.ClientTimeout(total=LETTERBOXD_REQUEST_TIMEOUT_SECONDS)
            )
        assert local_session is not None

        fetch_result = await get_letterboxd_page_async(
            session=local_session, tmdb_id=tmdb_id
        )
        if fetch_result.response is None:
            if fetch_result.not_found:
                if existing_resolution.movie_data is not None:
                    _cache_set(tmdb_id, existing_resolution.movie_data)
                    return existing_resolution.movie_data
                _cache_set(tmdb_id, None)
                return None
            if existing_resolution.movie_data is not None:
                _cache_set(tmdb_id, existing_resolution.movie_data)
                return existing_resolution.movie_data
            return None

        response = fetch_result.response
        slug = get_slug_from_url(response.url)
        if slug is None:
            _record_letterboxd_failure_event(
                event_type="slug_parse_failed",
                tmdb_id=tmdb_id,
                url=response.url,
                reason="missing_slug",
            )
            if existing_resolution.movie_data is not None:
                _cache_set(tmdb_id, existing_resolution.movie_data)
                return existing_resolution.movie_data
            return None

        parsed_page = parse_page_text(response.text)
        if film_not_found_text(response.text):
            logger.warning(f"Letterboxd page not found for TMDB ID {tmdb_id}")
            _record_letterboxd_failure_event(
                event_type="film_not_found_marker",
                tmdb_id=tmdb_id,
                url=response.url,
                reason="film_not_found_marker",
            )
            if existing_resolution.movie_data is not None:
                _cache_set(tmdb_id, existing_resolution.movie_data)
                return existing_resolution.movie_data
            _cache_set(tmdb_id, None)
            return None

        poster_url, rating, top250 = await asyncio.gather(
            get_poster_url_async(session=local_session, slug=slug),
            get_rating_async(session=local_session, slug=slug),
            get_top250_position_async(session=local_session, slug=slug),
        )

        title = get_english_title(parsed_page)
        original_title = get_original_title(parsed_page)
        release_year = get_year(parsed_page)
        directors = get_directors(parsed_page)

        result = LetterboxdMovieData(
            slug=slug,
            poster_url=poster_url,
            title=title,
            original_title=original_title,
            release_year=release_year,
            directors=directors,
            rating=rating,
            top250=top250,
            enriched_at=now_amsterdam_naive(),
        )
        _cache_set(tmdb_id, result)
        return result
    finally:
        if close_session and local_session is not None:
            await local_session.close()
        _finish_inflight(tmdb_id, inflight_event)


if __name__ == "__main__":
    tmdb_id = 570685
    logger.info(f"Scraping Letterboxd data for TMDB ID {tmdb_id}")
    data = scrape_letterboxd(tmdb_id)
    logger.info(f"Data: {data}")
