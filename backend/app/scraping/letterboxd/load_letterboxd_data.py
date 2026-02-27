import json
import os
import random
import subprocess
import tempfile
import time
from dataclasses import dataclass
from datetime import datetime
from threading import BoundedSemaphore, Lock
from typing import Any
from urllib.parse import urlparse

from bs4 import BeautifulSoup, Tag
from pydantic import BaseModel

from app.api.deps import get_db_context
from app.crud import movie as movies_crud
from app.exceptions import scraper_exceptions
from app.models.movie import MovieUpdate
from app.scraping.logger import logger
from app.utils import now_amsterdam_naive

HEADERS = {
    "referer": "https://letterboxd.com",
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
    "cache-control": "no-cache",
    "pragma": "no-cache",
    "upgrade-insecure-requests": "1",
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "same-origin",
    "sec-fetch-user": "?1",
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


_configured_letterboxd_http_concurrency = _env_int("LETTERBOXD_HTTP_CONCURRENCY", 1)
# Force single-threaded outbound traffic to reduce Cloudflare sensitivity.
LETTERBOXD_HTTP_CONCURRENCY = 1
if _configured_letterboxd_http_concurrency != 1:
    logger.warning(
        "LETTERBOXD_HTTP_CONCURRENCY=%s ignored; forcing 1 for Cloudflare friendliness.",
        _configured_letterboxd_http_concurrency,
    )
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
LETTERBOXD_BLOCK_STATE_FILE = os.getenv(
    "LETTERBOXD_BLOCK_STATE_FILE",
    "/tmp/cinema_agenda_letterboxd_block_state.json",
)
LETTERBOXD_COOKIE_JAR_FILE = os.getenv(
    "LETTERBOXD_COOKIE_JAR_FILE",
    "/tmp/cinema_agenda_letterboxd_cookies.txt",
)
LETTERBOXD_SESSION_REFRESH_URL = os.getenv(
    "LETTERBOXD_SESSION_REFRESH_URL",
    "https://letterboxd.com/",
)
LETTERBOXD_HTTP_403_RETRY_ATTEMPTS = _env_non_negative_int(
    "LETTERBOXD_HTTP_403_RETRY_ATTEMPTS",
    1,
)
LETTERBOXD_HTTP_403_STREAK_BLOCK_THRESHOLD = _env_int(
    "LETTERBOXD_HTTP_403_STREAK_BLOCK_THRESHOLD",
    2,
)
LETTERBOXD_HTTP_MAX_CALLS_PER_RUN = _env_non_negative_int(
    "LETTERBOXD_HTTP_MAX_CALLS_PER_RUN",
    0,
)
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
_letterboxd_rate_limit_lock = Lock()
_letterboxd_next_request_at: float = 0.0
_letterboxd_403_streak_lock = Lock()
_letterboxd_consecutive_403_count: int = 0
_letterboxd_challenge_block_lock = Lock()
_letterboxd_challenge_block_until: float = 0.0
_letterboxd_challenge_logged_until: float = 0.0
_letterboxd_challenge_reason: str | None = None
_letterboxd_failure_audit_lock = Lock()
_letterboxd_failure_audit_events: list[dict[str, Any]] = []
_letterboxd_request_budget_lock = Lock()
_letterboxd_http_calls_this_run: int = 0
_letterboxd_http_budget_exhausted_logged: bool = False
_letterboxd_real_request_attempt_calls: int = 0
_letterboxd_real_request_success_calls: int = 0


@dataclass(frozen=True)
class CurlResponse:
    url: str
    text: str
    status_code: int
    headers: dict[str, str]

    def json(self) -> Any:
        return json.loads(self.text)


@dataclass(frozen=True)
class SyncPageFetchResult:
    response: CurlResponse | None
    status_code: int | None
    not_found: bool = False
    blocked: bool = False


class LetterboxdMovieData(BaseModel):
    slug: str
    poster_url: str | None
    enriched_at: datetime | None = None


@dataclass(frozen=True)
class ExistingMovieResolution:
    movie_data: LetterboxdMovieData | None
    should_refetch: bool
    decision_reason: str
    age_days: float | None = None
    refresh_probability: float = 0.0


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
    with get_db_context() as session:
        movie = movies_crud.get_movie_by_id(session=session, id=tmdb_id)
    if movie is None:
        return ExistingMovieResolution(
            movie_data=None,
            should_refetch=True,
            decision_reason="movie_missing_in_db",
        )

    if not movie.letterboxd_slug:
        # No Letterboxd slug stored yet; try network fetch.
        return ExistingMovieResolution(
            movie_data=None,
            should_refetch=True,
            decision_reason="movie_without_letterboxd_slug",
        )

    existing_data = LetterboxdMovieData(
        slug=movie.letterboxd_slug,
        poster_url=movie.poster_link,
        enriched_at=movie.tmdb_last_enriched_at,
    )
    if movie.tmdb_last_enriched_at is None:
        age_days: float | None = None
    else:
        age_days = max(
            0.0,
            (now_amsterdam_naive() - movie.tmdb_last_enriched_at).total_seconds()
            / 86400.0,
        )
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
    response_meta: dict[str, Any] | None = None,
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
    if response_meta is not None:
        event["response_meta"] = response_meta

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
    global _letterboxd_real_request_attempt_calls
    global _letterboxd_real_request_success_calls
    with _letterboxd_request_budget_lock:
        _letterboxd_http_calls_this_run = 0
        _letterboxd_http_budget_exhausted_logged = False
        _letterboxd_real_request_attempt_calls = 0
        _letterboxd_real_request_success_calls = 0
    _reset_consecutive_403_counter()


def _reset_consecutive_403_counter() -> None:
    global _letterboxd_consecutive_403_count
    with _letterboxd_403_streak_lock:
        _letterboxd_consecutive_403_count = 0


def _increment_consecutive_403_counter() -> int:
    global _letterboxd_consecutive_403_count
    with _letterboxd_403_streak_lock:
        _letterboxd_consecutive_403_count += 1
        return _letterboxd_consecutive_403_count


def _consume_request_budget(url: str) -> bool:
    global _letterboxd_http_calls_this_run
    global _letterboxd_http_budget_exhausted_logged
    if LETTERBOXD_HTTP_MAX_CALLS_PER_RUN <= 0:
        return True
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


def _set_challenge_block(
    *,
    reason: str,
    url: str | None = None,
    status_code: int | None = None,
    response_meta: dict[str, Any] | None = None,
) -> None:
    global _letterboxd_challenge_block_until
    global _letterboxd_challenge_logged_until
    global _letterboxd_challenge_reason
    now = time.monotonic()
    now_unix = time.time()
    block_until = now + LETTERBOXD_CF_BLOCK_SECONDS
    block_remaining_seconds = LETTERBOXD_CF_BLOCK_SECONDS
    block_until_unix = now_unix + LETTERBOXD_CF_BLOCK_SECONDS
    with _letterboxd_request_budget_lock:
        request_counters = {
            "budget_consumed": _letterboxd_http_calls_this_run,
            "real_attempts": _letterboxd_real_request_attempt_calls,
            "real_successes": _letterboxd_real_request_success_calls,
        }
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
        elif reason in {"http_403_block", "http_403_streak_block"}:
            logger.warning(
                "Letterboxd returned repeated HTTP 403 responses; suppressing "
                f"Letterboxd HTTP calls for {LETTERBOXD_CF_BLOCK_SECONDS:.0f}s."
            )
        else:
            logger.warning(
                "Letterboxd temporarily rate-limited; suppressing Letterboxd HTTP "
                f"calls for {LETTERBOXD_CF_BLOCK_SECONDS:.0f}s."
            )
        logger.warning(
            "Letterboxd challenge diagnostics: url=%s status=%s "
            "attempts_before_trigger=%s successful_200_before_trigger=%s "
            "attempts_total=%s successful_200_total=%s budget_consumed=%s",
            url or "n/a",
            status_code if status_code is not None else "n/a",
            attempts_before_trigger,
            successful_before_trigger,
            request_counters["real_attempts"],
            request_counters["real_successes"],
            request_counters["budget_consumed"],
        )

    _record_letterboxd_failure_event(
        event_type=reason,
        url=url,
        tmdb_id=_extract_tmdb_id_from_url(url),
        status_code=status_code,
        reason=reason,
        block_remaining_seconds=block_remaining_seconds,
        request_counters=request_counters,
        response_meta=response_meta,
    )


_load_persisted_challenge_block_state()


def _is_cloudflare_challenge_text(text: str) -> bool:
    lowered = text.lower()
    return (
        "cf-challenge" in lowered
        or "error code 1020" in lowered
        or "sorry, you have been blocked" in lowered
        or "verify you are human" in lowered
        or (
            "cloudflare" in lowered
            and (
                "attention required" in lowered
                or "just a moment" in lowered
                or "please enable javascript" in lowered
                or "access denied" in lowered
            )
        )
    )


def _is_access_denied_text(text: str) -> bool:
    lowered = text.lower()
    return (
        "access denied" in lowered
        or "forbidden" in lowered
        or "error code 1020" in lowered
    )


def _response_meta(response: CurlResponse) -> dict[str, Any]:
    server = response.headers.get("server")
    cf_ray = response.headers.get("cf-ray")
    return {
        "effective_url": response.url,
        "server": server,
        "cf_ray": cf_ray,
        "cf_cache_status": response.headers.get("cf-cache-status"),
        "x_cache": response.headers.get("x-cache"),
        "x_cache_hits": response.headers.get("x-cache-hits"),
        "location": response.headers.get("location"),
        "content_type": response.headers.get("content-type"),
        "content_language": response.headers.get("content-language"),
        "challenge_marker_detected": _is_cloudflare_challenge_text(response.text),
        "access_denied_marker_detected": _is_access_denied_text(response.text),
        "cloudflare_header_detected": (
            bool(cf_ray) or (server is not None and "cloudflare" in server.lower())
        ),
    }


def _is_probable_automated_block(response: CurlResponse) -> bool:
    if response.status_code != 403:
        return False
    if _is_cloudflare_challenge_text(response.text):
        return True
    metadata = _response_meta(response)
    if metadata["access_denied_marker_detected"]:
        return True
    return bool(metadata["cloudflare_header_detected"])


def _parse_curl_headers(raw: str) -> dict[str, str]:
    blocks: list[list[str]] = []
    current_block: list[str] = []
    for raw_line in raw.splitlines():
        line = raw_line.strip("\r")
        if line.startswith("HTTP/"):
            if current_block:
                blocks.append(current_block)
            current_block = [line]
            continue
        if not line:
            if current_block:
                blocks.append(current_block)
                current_block = []
            continue
        if current_block:
            current_block.append(line)
    if current_block:
        blocks.append(current_block)

    if not blocks:
        return {}

    headers: dict[str, str] = {}
    for line in blocks[-1][1:]:
        if ":" not in line:
            continue
        key_raw, value_raw = line.split(":", 1)
        key = key_raw.strip().lower()
        value = value_raw.strip()
        if not key:
            continue
        if key in headers:
            headers[key] = f"{headers[key]}, {value}"
        else:
            headers[key] = value
    return headers


def _sleep_for_rate_limit_if_needed() -> None:
    if LETTERBOXD_MIN_REQUEST_INTERVAL_SECONDS <= 0:
        return
    global _letterboxd_next_request_at
    with _letterboxd_rate_limit_lock:
        now = time.monotonic()
        wait_for = max(0.0, _letterboxd_next_request_at - now)
        scheduled_at = now + wait_for
        _letterboxd_next_request_at = (
            scheduled_at + LETTERBOXD_MIN_REQUEST_INTERVAL_SECONDS
        )
    if wait_for > 0:
        time.sleep(wait_for)


def _perform_rate_limited_sync_request(*, url: str, transport: str) -> CurlResponse:
    with _letterboxd_http_sync_semaphore:
        _sleep_for_rate_limit_if_needed()
        _record_real_outbound_request_attempt(url=url, transport=transport)
        return _fetch_with_curl(url)


def _attempt_session_refresh_after_403(*, blocked_url: str, attempt: int) -> None:
    refresh_url = LETTERBOXD_SESSION_REFRESH_URL
    if not _consume_request_budget(refresh_url):
        logger.warning(
            "Letterboxd 403 recovery skipped session refresh because request budget is exhausted "
            "(blocked_url=%s attempt=%s).",
            blocked_url,
            attempt,
        )
        return

    try:
        refresh_response = _perform_rate_limited_sync_request(
            url=refresh_url,
            transport="sync_refresh",
        )
    except RuntimeError as e:
        logger.warning(
            "Letterboxd 403 recovery session refresh failed "
            "(blocked_url=%s attempt=%s). Error: %s",
            blocked_url,
            attempt,
            e,
        )
        _record_letterboxd_failure_event(
            event_type="session_refresh_error",
            url=refresh_url,
            reason=f"{type(e).__name__}: {e}",
        )
        return

    refresh_meta = _response_meta(refresh_response)
    if refresh_response.status_code == 200:
        _record_real_outbound_request_success(url=refresh_url, transport="sync_refresh")
        logger.debug(
            "Letterboxd session refresh succeeded after 403 "
            "(blocked_url=%s attempt=%s cf_ray=%s).",
            blocked_url,
            attempt,
            refresh_meta.get("cf_ray"),
        )
        return

    logger.warning(
        "Letterboxd session refresh returned non-200 status after 403 "
        "(blocked_url=%s attempt=%s status=%s cf_ray=%s).",
        blocked_url,
        attempt,
        refresh_response.status_code,
        refresh_meta.get("cf_ray"),
    )
    _record_letterboxd_failure_event(
        event_type="session_refresh_http_error",
        url=refresh_url,
        status_code=refresh_response.status_code,
        reason=f"http_{refresh_response.status_code}",
        response_meta=refresh_meta,
    )


def _fetch_with_curl(url: str) -> CurlResponse:
    status_marker = "__CINEMA_CURL_HTTP_CODE__:"
    effective_url_marker = "__CINEMA_CURL_EFFECTIVE_URL__:"
    write_out = (
        f"\n{status_marker}%{{http_code}}\n{effective_url_marker}%{{url_effective}}\n"
    )

    cookie_jar_dir = os.path.dirname(LETTERBOXD_COOKIE_JAR_FILE)
    if cookie_jar_dir:
        os.makedirs(cookie_jar_dir, exist_ok=True)

    header_file_path: str | None = None
    with tempfile.NamedTemporaryFile(
        mode="w+",
        prefix="letterboxd_headers_",
        delete=False,
    ) as header_file:
        header_file_path = header_file.name

    command = [
        "curl",
        "--silent",
        "--show-error",
        "--location",
        "--http2",
        "--compressed",
        "--max-time",
        f"{LETTERBOXD_REQUEST_TIMEOUT_SECONDS:.2f}",
        "--cookie",
        LETTERBOXD_COOKIE_JAR_FILE,
        "--cookie-jar",
        LETTERBOXD_COOKIE_JAR_FILE,
        "--dump-header",
        header_file_path,
        *[arg for name, value in HEADERS.items() for arg in ("-H", f"{name}: {value}")],
        "--write-out",
        write_out,
        url,
    ]
    try:
        result = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
        )
    finally:
        headers_text = ""
        if header_file_path is not None:
            try:
                with open(header_file_path, encoding="utf-8") as fp:
                    headers_text = fp.read()
            except Exception:
                headers_text = ""
            try:
                os.remove(header_file_path)
            except OSError:
                pass
    if result.returncode != 0:
        stderr = result.stderr.strip() or "curl failed"
        raise RuntimeError(stderr)

    output = result.stdout
    marker_index = output.rfind(status_marker)
    if marker_index < 0:
        raise RuntimeError("curl output missing status marker")

    body = output[:marker_index]
    metadata = output[marker_index:].splitlines()
    raw_status = ""
    effective_url = url
    for line in metadata:
        if line.startswith(status_marker):
            raw_status = line[len(status_marker) :].strip()
        elif line.startswith(effective_url_marker):
            parsed_effective_url = line[len(effective_url_marker) :].strip()
            if parsed_effective_url:
                effective_url = parsed_effective_url
    try:
        status_code = int(raw_status)
    except ValueError as e:
        raise RuntimeError(f"invalid curl status code: {raw_status}") from e

    headers = _parse_curl_headers(headers_text)
    return CurlResponse(
        url=effective_url,
        text=body,
        status_code=status_code,
        headers=headers,
    )


def _fetch_page(url: str) -> SyncPageFetchResult:
    with _letterboxd_challenge_block_lock:
        remaining = max(0.0, _letterboxd_challenge_block_until - time.monotonic())
        reason = _letterboxd_challenge_reason or "cooldown_active"
        block_active = remaining > 0

    if block_active:
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

    if not _consume_request_budget(url):
        return SyncPageFetchResult(
            response=None,
            status_code=None,
            blocked=True,
        )

    attempts = max(
        LETTERBOXD_HTTP_RETRIES + 1,
        LETTERBOXD_HTTP_403_RETRY_ATTEMPTS + 1,
    )
    observed_403_attempts = 0
    for attempt in range(attempts):
        try:
            response = _perform_rate_limited_sync_request(url=url, transport="sync")
        except RuntimeError as e:
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

        if response.status_code != 403:
            _reset_consecutive_403_counter()

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

        if response.status_code == 403:
            observed_403_attempts += 1
            probable_block = _is_probable_automated_block(response)
            consecutive_403_count = _increment_consecutive_403_counter()
            response_meta = _response_meta(response)
            response_meta["attempt"] = attempt + 1
            response_meta["attempts_total"] = attempts
            response_meta["observed_403_attempts"] = observed_403_attempts
            response_meta["consecutive_403_count"] = consecutive_403_count
            response_meta["probable_automated_block"] = probable_block

            should_retry_403 = (
                probable_block
                and attempt < attempts - 1
                and observed_403_attempts <= LETTERBOXD_HTTP_403_RETRY_ATTEMPTS
            )

            _record_letterboxd_failure_event(
                event_type="http_403_observed",
                url=url,
                tmdb_id=_extract_tmdb_id_from_url(url),
                status_code=403,
                reason=(
                    "http_403_probable_automated_block"
                    if probable_block
                    else "http_403_unclassified"
                ),
                response_meta=response_meta,
            )

            if should_retry_403:
                logger.warning(
                    "Letterboxd returned HTTP 403; retrying with session refresh "
                    "(attempt=%s/%s consecutive_403=%s probable_block=%s cf_ray=%s url=%s)",
                    attempt + 1,
                    attempts,
                    consecutive_403_count,
                    probable_block,
                    response_meta.get("cf_ray"),
                    url,
                )
                _attempt_session_refresh_after_403(
                    blocked_url=url,
                    attempt=attempt + 1,
                )
                delay = _retry_delay(attempt)
                time.sleep(delay)
                continue

            if probable_block:
                block_reason = "http_403_block"
                if consecutive_403_count >= LETTERBOXD_HTTP_403_STREAK_BLOCK_THRESHOLD:
                    block_reason = "http_403_streak_block"
                _set_challenge_block(
                    reason=block_reason,
                    url=url,
                    status_code=403,
                    response_meta=response_meta,
                )
                return SyncPageFetchResult(
                    response=None,
                    status_code=403,
                    blocked=True,
                )

            logger.warning(
                "Letterboxd returned unclassified HTTP 403 "
                "(attempt=%s/%s cf_ray=%s url=%s)",
                attempt + 1,
                attempts,
                response_meta.get("cf_ray"),
                url,
            )
            _record_letterboxd_failure_event(
                event_type="http_error",
                url=url,
                tmdb_id=_extract_tmdb_id_from_url(url),
                status_code=403,
                reason="http_403",
                response_meta=response_meta,
            )
            return SyncPageFetchResult(response=None, status_code=403)

        if response.status_code == 429:
            _set_challenge_block(
                reason="rate_limited",
                url=url,
                status_code=429,
                response_meta=_response_meta(response),
            )
            return SyncPageFetchResult(
                response=None,
                status_code=429,
                blocked=True,
            )

        if (
            response.status_code in {408, 425, 500, 502, 503, 504}
            and attempt < attempts - 1
        ):
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
            response_meta=_response_meta(response),
        )
        return SyncPageFetchResult(response=None, status_code=response.status_code)

    return SyncPageFetchResult(response=None, status_code=None)


def get_poster_url(slug: str) -> str | None:
    url = f"https://letterboxd.com/film/{slug}/poster/std/230/"
    fetch_result = _fetch_page(url)
    response = fetch_result.response
    if response is None:
        return None
    json = response.json()
    if not isinstance(json, dict):
        raise scraper_exceptions.ScraperStructureError()
    return json.get("url")


def scrape_letterboxd(tmdb_id: int) -> LetterboxdMovieData | None:
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

    fetch_result = _fetch_page(f"https://letterboxd.com/tmdb/{tmdb_id}/")
    if fetch_result.response is None:
        if fetch_result.not_found:
            if existing_resolution.movie_data is not None:
                logger.debug(
                    "Letterboxd fetch 404 for TMDB ID %s; using existing DB data",
                    tmdb_id,
                )
                return existing_resolution.movie_data
            return None
        if existing_resolution.movie_data is not None:
            logger.debug(
                "Letterboxd fetch unavailable for TMDB ID %s; using existing DB data",
                tmdb_id,
            )
            return existing_resolution.movie_data
        return None

    response = fetch_result.response
    final_url_parts = [
        part for part in urlparse(str(response.url)).path.split("/") if part
    ]
    slug = final_url_parts[-1] if final_url_parts else None
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
            return existing_resolution.movie_data
        return None

    page = BeautifulSoup(response.text, "lxml")
    not_found_tag = page.find("h1", class_="title")
    if isinstance(not_found_tag, Tag) and not_found_tag.text == "Film not found":
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
            return existing_resolution.movie_data
        return None

    poster_url = get_poster_url(slug)
    return LetterboxdMovieData(
        slug=slug,
        poster_url=poster_url,
        enriched_at=now_amsterdam_naive(),
    )


@dataclass(frozen=True)
class LetterboxdBackfillSummary:
    candidates: int
    updated: int
    skipped: int
    failed: int


def backfill_missing_letterboxd_data() -> LetterboxdBackfillSummary:
    with get_db_context() as session:
        candidate_ids = [
            movie.id
            for movie in movies_crud.get_movies_without_letterboxd_slug(session=session)
        ]

    if not candidate_ids:
        logger.info("Letterboxd backfill: no movies without slug found.")
        return LetterboxdBackfillSummary(candidates=0, updated=0, skipped=0, failed=0)

    updated = 0
    skipped = 0
    failed = 0

    for tmdb_id in candidate_ids:
        letterboxd_data = scrape_letterboxd(tmdb_id)
        if letterboxd_data is None or not letterboxd_data.slug:
            failed += 1
            continue

        movie_update = MovieUpdate(
            letterboxd_slug=letterboxd_data.slug,
            poster_link=letterboxd_data.poster_url,
            tmdb_last_enriched_at=letterboxd_data.enriched_at,
        )
        with get_db_context() as session:
            db_movie = movies_crud.get_movie_by_id(session=session, id=tmdb_id)
            if db_movie is None:
                failed += 1
                continue
            if db_movie.letterboxd_slug:
                skipped += 1
                continue
            movies_crud.update_movie(db_movie=db_movie, movie_update=movie_update)
            session.add(db_movie)
            session.commit()
            updated += 1

    summary = LetterboxdBackfillSummary(
        candidates=len(candidate_ids),
        updated=updated,
        skipped=skipped,
        failed=failed,
    )
    logger.info(
        "Letterboxd backfill complete: candidates=%s updated=%s skipped=%s failed=%s",
        summary.candidates,
        summary.updated,
        summary.skipped,
        summary.failed,
    )
    return summary


if __name__ == "__main__":
    tmdb_id = 570685
    logger.info(f"Scraping Letterboxd data for TMDB ID {tmdb_id}")
    data = scrape_letterboxd(tmdb_id)
    logger.info(f"Data: {data}")
