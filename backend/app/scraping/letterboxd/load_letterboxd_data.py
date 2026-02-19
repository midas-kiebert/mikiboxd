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

import httpx
from bs4 import BeautifulSoup, Tag
from pydantic import BaseModel

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


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    value = raw.strip().lower()
    if value in {"1", "true", "yes", "y", "on"}:
        return True
    if value in {"0", "false", "no", "n", "off"}:
        return False
    return default


LETTERBOXD_HTTP_CONCURRENCY = _env_int("LETTERBOXD_HTTP_CONCURRENCY", 1)
LETTERBOXD_HTTP_RETRIES = _env_int("LETTERBOXD_HTTP_RETRIES", 2)
LETTERBOXD_HTTP_BACKOFF_SECONDS = _env_float("LETTERBOXD_HTTP_BACKOFF_SECONDS", 0.4)
LETTERBOXD_MIN_REQUEST_INTERVAL_SECONDS = _env_float(
    "LETTERBOXD_MIN_REQUEST_INTERVAL_SECONDS",
    8.0,
)
LETTERBOXD_REQUEST_TIMEOUT_SECONDS = _env_float(
    "LETTERBOXD_REQUEST_TIMEOUT_SECONDS",
    20.0,
)
LETTERBOXD_CF_BLOCK_SECONDS = _env_float("LETTERBOXD_CF_BLOCK_SECONDS", 900.0)
LETTERBOXD_BLOCK_STATE_FILE = os.getenv(
    "LETTERBOXD_BLOCK_STATE_FILE",
    "/tmp/cinema_agenda_letterboxd_block_state.json",
)
LETTERBOXD_HTTP_MAX_CALLS_PER_RUN = _env_non_negative_int(
    "LETTERBOXD_HTTP_MAX_CALLS_PER_RUN",
    20,
)
LETTERBOXD_HTTP_DRY_RUN = _env_bool("LETTERBOXD_HTTP_DRY_RUN", False)
LETTERBOXD_REFRESH_AFTER_DAYS = _env_non_negative_int(
    "LETTERBOXD_REFRESH_AFTER_DAYS",
    5,
)
LETTERBOXD_STALE_REFRESH_BASE_PROBABILITY = _env_probability(
    "LETTERBOXD_STALE_REFRESH_BASE_PROBABILITY",
    0.05,
)
LETTERBOXD_STALE_REFRESH_DAILY_INCREASE = _env_float(
    "LETTERBOXD_STALE_REFRESH_DAILY_INCREASE",
    0.03,
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
_letterboxd_request_budget_lock = Lock()
_letterboxd_http_calls_this_run: int = 0
_letterboxd_http_budget_exhausted_logged: bool = False
_letterboxd_dry_run_request_calls: int = 0
_letterboxd_dry_run_notice_logged: bool = False
_letterboxd_real_request_attempt_calls: int = 0
_letterboxd_real_request_success_calls: int = 0

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
    response: httpx.Response | None
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
    decision_reason: str
    age_days: float | None = None
    refresh_probability: float = 0.0


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
        rating=None,
        top250=None,
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
        return ExistingMovieResolution(
            movie_data=None,
            should_refetch=True,
            decision_reason="movie_missing_in_db",
        )

    existing_data = _movie_to_letterboxd_data(movie)
    if existing_data is None:
        # No Letterboxd slug stored yet; try network fetch.
        return ExistingMovieResolution(
            movie_data=None,
            should_refetch=True,
            decision_reason="movie_without_letterboxd_slug",
        )

    age_days = _age_days(movie, now_amsterdam_naive())
    refresh_probability = _stale_refresh_probability(age_days)
    if refresh_probability <= 0.0:
        return ExistingMovieResolution(
            movie_data=existing_data,
            should_refetch=False,
            decision_reason="fresh_enrichment_in_db",
            age_days=age_days,
            refresh_probability=refresh_probability,
        )

    should_refetch = random.random() < refresh_probability
    return ExistingMovieResolution(
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
    request_counters: dict[str, int] | None = None,
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
    if request_counters is not None:
        event["request_counters"] = request_counters

    with _letterboxd_failure_audit_lock:
        _letterboxd_failure_audit_events.append(event)


def consume_letterboxd_failure_events() -> list[dict[str, Any]]:
    with _letterboxd_failure_audit_lock:
        events = list(_letterboxd_failure_audit_events)
        _letterboxd_failure_audit_events.clear()
    return events


def reset_letterboxd_request_budget() -> None:
    global _letterboxd_http_calls_this_run
    global _letterboxd_http_budget_exhausted_logged
    global _letterboxd_dry_run_request_calls
    global _letterboxd_dry_run_notice_logged
    global _letterboxd_real_request_attempt_calls
    global _letterboxd_real_request_success_calls
    with _letterboxd_request_budget_lock:
        _letterboxd_http_calls_this_run = 0
        _letterboxd_http_budget_exhausted_logged = False
        _letterboxd_dry_run_request_calls = 0
        _letterboxd_dry_run_notice_logged = False
        _letterboxd_real_request_attempt_calls = 0
        _letterboxd_real_request_success_calls = 0


def _consume_request_budget(url: str) -> bool:
    global _letterboxd_http_calls_this_run
    global _letterboxd_http_budget_exhausted_logged
    if LETTERBOXD_HTTP_MAX_CALLS_PER_RUN <= 0:
        return False
    with _letterboxd_request_budget_lock:
        if _letterboxd_http_calls_this_run >= LETTERBOXD_HTTP_MAX_CALLS_PER_RUN:
            should_log = not _letterboxd_http_budget_exhausted_logged
            _letterboxd_http_budget_exhausted_logged = True
        else:
            _letterboxd_http_calls_this_run += 1
            return True

    if should_log:
        logger.warning(
            "Letterboxd HTTP budget exhausted for this run; suppressing further "
            f"Letterboxd calls (max={LETTERBOXD_HTTP_MAX_CALLS_PER_RUN})."
        )
        _record_letterboxd_failure_event(
            event_type="request_budget_exhausted",
            url=url,
            tmdb_id=_extract_tmdb_id_from_url(url),
            reason=f"max_calls_per_run={LETTERBOXD_HTTP_MAX_CALLS_PER_RUN}",
        )
    return False


def _record_dry_run_request(url: str, transport: str) -> None:
    global _letterboxd_dry_run_request_calls
    global _letterboxd_dry_run_notice_logged
    with _letterboxd_request_budget_lock:
        _letterboxd_dry_run_request_calls += 1
        call_number = _letterboxd_dry_run_request_calls
        should_log_notice = not _letterboxd_dry_run_notice_logged
        if should_log_notice:
            _letterboxd_dry_run_notice_logged = True

    if should_log_notice:
        logger.warning(
            "LETTERBOXD_HTTP_DRY_RUN is enabled; suppressing all outbound "
            "Letterboxd HTTP requests and logging would-be calls."
        )
    logger.info(
        "Letterboxd dry-run would-request #%s (%s): %s",
        call_number,
        transport,
        url,
    )
    _record_letterboxd_failure_event(
        event_type="dry_run_would_request",
        url=url,
        tmdb_id=_extract_tmdb_id_from_url(url),
        reason=f"transport={transport}",
    )


def _record_real_outbound_request_attempt(url: str, transport: str) -> None:
    global _letterboxd_real_request_attempt_calls
    with _letterboxd_request_budget_lock:
        _letterboxd_real_request_attempt_calls += 1
        request_number = _letterboxd_real_request_attempt_calls
    logger.debug(
        "Letterboxd outbound request #%s (%s): %s",
        request_number,
        transport,
        url,
    )


def _record_real_outbound_request_success(url: str, transport: str) -> None:
    global _letterboxd_real_request_success_calls
    with _letterboxd_request_budget_lock:
        _letterboxd_real_request_success_calls += 1
        success_number = _letterboxd_real_request_success_calls
    logger.debug(
        "Letterboxd successful response #%s (%s): %s",
        success_number,
        transport,
        url,
    )


def _request_counter_snapshot() -> dict[str, int]:
    with _letterboxd_request_budget_lock:
        return {
            "budget_consumed": _letterboxd_http_calls_this_run,
            "dry_run_would_request": _letterboxd_dry_run_request_calls,
            "real_attempts": _letterboxd_real_request_attempt_calls,
            "real_successes": _letterboxd_real_request_success_calls,
        }


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


def _persist_challenge_block_state(*, block_until_unix: float, reason: str) -> None:
    if not LETTERBOXD_BLOCK_STATE_FILE:
        return
    payload = {
        "block_until_unix": block_until_unix,
        "reason": reason,
    }
    try:
        directory = os.path.dirname(LETTERBOXD_BLOCK_STATE_FILE)
        if directory:
            os.makedirs(directory, exist_ok=True)
        tmp_path = f"{LETTERBOXD_BLOCK_STATE_FILE}.tmp"
        with open(tmp_path, "w", encoding="utf-8") as fp:
            json.dump(payload, fp)
        os.replace(tmp_path, LETTERBOXD_BLOCK_STATE_FILE)
    except Exception as e:
        logger.debug(f"Could not persist Letterboxd block state. Error: {e}")


def _load_persisted_challenge_block_state() -> None:
    global _letterboxd_challenge_block_until
    global _letterboxd_challenge_reason
    if not LETTERBOXD_BLOCK_STATE_FILE:
        return
    try:
        with open(LETTERBOXD_BLOCK_STATE_FILE, encoding="utf-8") as fp:
            payload = json.load(fp)
    except FileNotFoundError:
        return
    except Exception as e:
        logger.debug(f"Could not read Letterboxd block state file. Error: {e}")
        return

    if not isinstance(payload, dict):
        return
    raw_until = payload.get("block_until_unix")
    if raw_until is None:
        return
    try:
        block_until_unix = float(raw_until)
    except (TypeError, ValueError):
        return
    remaining_seconds = max(0.0, block_until_unix - time.time())
    if remaining_seconds <= 0:
        return
    reason_raw = payload.get("reason")
    reason = str(reason_raw) if reason_raw is not None else "persisted_block"
    with _letterboxd_challenge_block_lock:
        persisted_until = time.monotonic() + remaining_seconds
        if persisted_until > _letterboxd_challenge_block_until:
            _letterboxd_challenge_block_until = persisted_until
            _letterboxd_challenge_reason = reason
    logger.warning(
        "Letterboxd cooldown restored from persisted state; suppressing HTTP calls "
        f"for another {remaining_seconds:.0f}s."
    )


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
    now_unix = time.time()
    block_until = now + LETTERBOXD_CF_BLOCK_SECONDS
    block_remaining_seconds = LETTERBOXD_CF_BLOCK_SECONDS
    block_until_unix = now_unix + LETTERBOXD_CF_BLOCK_SECONDS
    request_counters = _request_counter_snapshot()
    attempts_before_trigger = max(0, request_counters["real_attempts"] - 1)
    successful_before_trigger = request_counters["real_successes"]
    should_log = False
    with _letterboxd_challenge_block_lock:
        if block_until > _letterboxd_challenge_block_until:
            _letterboxd_challenge_block_until = block_until
        _letterboxd_challenge_reason = reason
        block_remaining_seconds = max(0.0, _letterboxd_challenge_block_until - now)
        block_until_unix = now_unix + block_remaining_seconds
        if now >= _letterboxd_challenge_logged_until:
            _letterboxd_challenge_logged_until = _letterboxd_challenge_block_until
            should_log = True

    _persist_challenge_block_state(
        block_until_unix=block_until_unix,
        reason=reason,
    )

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
        logger.warning(
            "Letterboxd challenge diagnostics: url=%s status=%s "
            "attempts_before_trigger=%s successful_200_before_trigger=%s "
            "attempts_total=%s successful_200_total=%s budget_consumed=%s dry_run_would_request=%s",
            url or "n/a",
            status_code if status_code is not None else "n/a",
            attempts_before_trigger,
            successful_before_trigger,
            request_counters["real_attempts"],
            request_counters["real_successes"],
            request_counters["budget_consumed"],
            request_counters["dry_run_would_request"],
        )

    _record_letterboxd_failure_event(
        event_type=reason,
        url=url,
        tmdb_id=_extract_tmdb_id_from_url(url),
        status_code=status_code,
        reason=reason,
        block_remaining_seconds=block_remaining_seconds,
        request_counters=request_counters,
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


_load_persisted_challenge_block_state()


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
    if _challenge_block_active() and not LETTERBOXD_HTTP_DRY_RUN:
        reason = _challenge_block_reason() or "cooldown_active"
        remaining = _challenge_block_remaining_seconds()
        logger.debug(
            "Skipping Letterboxd call during challenge cooldown "
            f"(reason={reason}, remaining={remaining:.0f}s): {url}"
        )
        _record_letterboxd_failure_event(
            event_type="cooldown_skip",
            url=url,
            tmdb_id=_extract_tmdb_id_from_url(url),
            reason=reason,
            block_remaining_seconds=remaining,
        )
        return SyncPageFetchResult(
            response=None,
            status_code=None,
            blocked=True,
        )

    if LETTERBOXD_HTTP_DRY_RUN:
        _record_dry_run_request(url=url, transport="sync")
        return SyncPageFetchResult(
            response=None,
            status_code=None,
            blocked=True,
        )

    if not _consume_request_budget(url):
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
                _record_real_outbound_request_attempt(url=url, transport="sync")
                with httpx.Client(
                    http2=True,
                    follow_redirects=True,
                    timeout=LETTERBOXD_REQUEST_TIMEOUT_SECONDS,
                ) as client:
                    response = client.get(
                        url,
                        headers=HEADERS,
                    )
        except httpx.RequestError as e:
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
            _record_real_outbound_request_success(url=url, transport="sync")
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


def get_page(url: str) -> httpx.Response | None:
    return _fetch_page(url).response


async def _fetch_page_async(
    *,
    session: httpx.AsyncClient,
    url: str,
) -> AsyncPageFetchResult:
    if _challenge_block_active() and not LETTERBOXD_HTTP_DRY_RUN:
        reason = _challenge_block_reason() or "cooldown_active"
        remaining = _challenge_block_remaining_seconds()
        logger.debug(
            "Skipping Letterboxd call during challenge cooldown "
            f"(reason={reason}, remaining={remaining:.0f}s): {url}"
        )
        _record_letterboxd_failure_event(
            event_type="cooldown_skip",
            url=url,
            tmdb_id=_extract_tmdb_id_from_url(url),
            reason=reason,
            block_remaining_seconds=remaining,
        )
        return AsyncPageFetchResult(
            response=None,
            status_code=None,
            blocked=True,
        )

    if LETTERBOXD_HTTP_DRY_RUN:
        _record_dry_run_request(url=url, transport="async")
        return AsyncPageFetchResult(
            response=None,
            status_code=None,
            blocked=True,
        )

    if not _consume_request_budget(url):
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
                _record_real_outbound_request_attempt(url=url, transport="async")
                response = await session.get(
                    url,
                    headers=HEADERS,
                )
                text = response.text
                if response.status_code == 200:
                    _record_real_outbound_request_success(url=url, transport="async")
                    return AsyncPageFetchResult(
                        response=AsyncPageResponse(url=str(response.url), text=text),
                        status_code=200,
                    )
                if response.status_code == 404:
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
                if response.status_code == 403 and (
                    _is_cloudflare_challenge(response.headers)
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
                if response.status_code == 429:
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
                if (
                    _is_retryable_status(response.status_code)
                    and attempt < attempts - 1
                ):
                    delay = _retry_delay(attempt)
                    logger.debug(
                        f"Retrying Letterboxd page {url} after status {response.status_code}: {delay:.2f}s"
                    )
                    await asyncio.sleep(delay)
                    continue
                logger.warning(
                    f"Failed to fetch page {url}. Status code: {response.status_code}"
                )
                _record_letterboxd_failure_event(
                    event_type="http_error",
                    url=url,
                    tmdb_id=_extract_tmdb_id_from_url(url),
                    status_code=response.status_code,
                    reason=f"http_{response.status_code}",
                )
                return AsyncPageFetchResult(
                    response=None,
                    status_code=response.status_code,
                )
        except httpx.RequestError as e:
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
    session: httpx.AsyncClient,
    url: str,
) -> AsyncPageResponse | None:
    return (await _fetch_page_async(session=session, url=url)).response


def get_letterboxd_page(tmdb_id: int) -> SyncPageFetchResult:
    url = f"https://letterboxd.com/tmdb/{tmdb_id}/"
    return _fetch_page(url)


async def get_letterboxd_page_async(
    *,
    session: httpx.AsyncClient,
    tmdb_id: int,
) -> AsyncPageFetchResult:
    url = f"https://letterboxd.com/tmdb/{tmdb_id}/"
    return await _fetch_page_async(session=session, url=url)


def parse_page(response: httpx.Response) -> BeautifulSoup:
    return BeautifulSoup(response.text, "lxml")


def parse_page_text(text: str) -> BeautifulSoup:
    return BeautifulSoup(text, "lxml")


def get_slug(response: httpx.Response) -> str:
    final_url = str(response.url)
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
    session: httpx.AsyncClient,
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
    session: httpx.AsyncClient,
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
    session: httpx.AsyncClient,
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


def film_not_found(response: httpx.Response) -> bool:
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
            logger.debug(
                "Letterboxd decision for TMDB ID %s: skip network (%s, age_days=%s, p=%.4f)",
                tmdb_id,
                existing_resolution.decision_reason,
                (
                    f"{existing_resolution.age_days:.2f}"
                    if existing_resolution.age_days is not None
                    else "n/a"
                ),
                existing_resolution.refresh_probability,
            )
            _cache_set(tmdb_id, existing_resolution.movie_data)
            return existing_resolution.movie_data
        logger.debug(
            "Letterboxd decision for TMDB ID %s: fetch network (%s, age_days=%s, p=%.4f)",
            tmdb_id,
            existing_resolution.decision_reason,
            (
                f"{existing_resolution.age_days:.2f}"
                if existing_resolution.age_days is not None
                else "n/a"
            ),
            existing_resolution.refresh_probability,
        )

        fetch_result = get_letterboxd_page(tmdb_id)
        if fetch_result.response is None:
            if fetch_result.not_found:
                if existing_resolution.movie_data is not None:
                    logger.debug(
                        "Letterboxd fetch 404 for TMDB ID %s; using existing DB data",
                        tmdb_id,
                    )
                    _cache_set(tmdb_id, existing_resolution.movie_data)
                    return existing_resolution.movie_data
                _cache_set(tmdb_id, None)
                return None
            if existing_resolution.movie_data is not None:
                logger.debug(
                    "Letterboxd fetch unavailable for TMDB ID %s; using existing DB data",
                    tmdb_id,
                )
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
                logger.debug(
                    "Letterboxd slug parse failed for TMDB ID %s; using existing DB data",
                    tmdb_id,
                )
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
                logger.debug(
                    "Letterboxd not-found marker for TMDB ID %s; using existing DB data",
                    tmdb_id,
                )
                _cache_set(tmdb_id, existing_resolution.movie_data)
                return existing_resolution.movie_data
            _cache_set(tmdb_id, None)
            return None

        poster_url = get_poster_url(slug)
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
            rating=None,
            top250=None,
            enriched_at=now_amsterdam_naive(),
        )
        _cache_set(tmdb_id, result)
        return result
    finally:
        _finish_inflight(tmdb_id, inflight_event)


async def scrape_letterboxd_async(
    *,
    tmdb_id: int,
    session: httpx.AsyncClient | None = None,
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
            logger.debug(
                "Letterboxd decision for TMDB ID %s: skip network (%s, age_days=%s, p=%.4f)",
                tmdb_id,
                existing_resolution.decision_reason,
                (
                    f"{existing_resolution.age_days:.2f}"
                    if existing_resolution.age_days is not None
                    else "n/a"
                ),
                existing_resolution.refresh_probability,
            )
            _cache_set(tmdb_id, existing_resolution.movie_data)
            return existing_resolution.movie_data
        logger.debug(
            "Letterboxd decision for TMDB ID %s: fetch network (%s, age_days=%s, p=%.4f)",
            tmdb_id,
            existing_resolution.decision_reason,
            (
                f"{existing_resolution.age_days:.2f}"
                if existing_resolution.age_days is not None
                else "n/a"
            ),
            existing_resolution.refresh_probability,
        )

        if close_session:
            local_session = httpx.AsyncClient(
                http2=True,
                follow_redirects=True,
                timeout=LETTERBOXD_REQUEST_TIMEOUT_SECONDS,
            )
        assert local_session is not None

        fetch_result = await get_letterboxd_page_async(
            session=local_session, tmdb_id=tmdb_id
        )
        if fetch_result.response is None:
            if fetch_result.not_found:
                if existing_resolution.movie_data is not None:
                    logger.debug(
                        "Letterboxd fetch 404 for TMDB ID %s; using existing DB data",
                        tmdb_id,
                    )
                    _cache_set(tmdb_id, existing_resolution.movie_data)
                    return existing_resolution.movie_data
                _cache_set(tmdb_id, None)
                return None
            if existing_resolution.movie_data is not None:
                logger.debug(
                    "Letterboxd fetch unavailable for TMDB ID %s; using existing DB data",
                    tmdb_id,
                )
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
                logger.debug(
                    "Letterboxd slug parse failed for TMDB ID %s; using existing DB data",
                    tmdb_id,
                )
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
                logger.debug(
                    "Letterboxd not-found marker for TMDB ID %s; using existing DB data",
                    tmdb_id,
                )
                _cache_set(tmdb_id, existing_resolution.movie_data)
                return existing_resolution.movie_data
            _cache_set(tmdb_id, None)
            return None

        poster_url = await get_poster_url_async(session=local_session, slug=slug)

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
            rating=None,
            top250=None,
            enriched_at=now_amsterdam_naive(),
        )
        _cache_set(tmdb_id, result)
        return result
    finally:
        if close_session and local_session is not None:
            await local_session.aclose()
        _finish_inflight(tmdb_id, inflight_event)


if __name__ == "__main__":
    tmdb_id = 570685
    logger.info(f"Scraping Letterboxd data for TMDB ID {tmdb_id}")
    data = scrape_letterboxd(tmdb_id)
    logger.info(f"Data: {data}")
