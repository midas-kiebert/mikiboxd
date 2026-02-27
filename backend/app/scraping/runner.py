import json
import re
import sys
import threading
import unicodedata
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from html import escape
from pathlib import Path
from typing import Any

from rapidfuzz import fuzz
from sqlalchemy import func
from sqlmodel import Session, col, delete, select

from app.api.deps import get_db_context
from app.core.config import settings
from app.models.cinema import Cinema
from app.models.movie import Movie
from app.models.scrape_run import ScrapeRun, ScrapeRunStatus
from app.models.showtime import Showtime
from app.models.showtime_source_presence import ShowtimeSourcePresence
from app.scraping.letterboxd.load_letterboxd_data import (
    LETTERBOXD_CF_BLOCK_SECONDS,
    LETTERBOXD_HTTP_403_RETRY_ATTEMPTS,
    LETTERBOXD_HTTP_403_STREAK_BLOCK_THRESHOLD,
    LETTERBOXD_HTTP_CONCURRENCY,
    LETTERBOXD_MIN_REQUEST_INTERVAL_SECONDS,
    backfill_missing_letterboxd_data,
    consume_letterboxd_failure_events,
    reset_letterboxd_request_budget,
)
from app.scraping.logger import logger
from app.scraping.scrape import (
    ScrapeExecutionSummary,
    run_cinema_scrapers,
    scrape_cineville,
)
from app.scraping.tmdb_runtime import (
    consume_tmdb_lookup_events,
    reset_tmdb_runtime_state,
)
from app.services import scrape_sync as scrape_sync_service
from app.services.scrape_sync import DeletedShowtimeInfo
from app.utils import clean_title, now_amsterdam_naive, send_email

RECAP_EMAIL_TO = "scraper.mikino@midaskiebert.nl"
STAGE_PATTERN = re.compile(r"(^|\s)stage=([^|]+)")
TITLE_NORMALIZE_PATTERN = re.compile(r"[^a-z0-9]+")
CINEVILLE_STREAM_PREFIX = "cineville:"
CINEMA_SCRAPER_STREAM_PREFIX = "cinema_scraper:"
SINGLE_TOKEN_SIMILARITY_THRESHOLD = 92.0
TITLE_SIMILARITY_THRESHOLD = 85.0
TMDB_LOW_CONFIDENCE_THRESHOLD = 80.0
TMDB_RECAP_ATTACHMENT_MAX_ITEMS = 300
TMDB_RESOLUTION_AUDIT_DIR_NAME = "tmp_tmdb_resolution_audit"
TMDB_MARKDOWN_CANDIDATE_LIMIT = 5


@dataclass(frozen=True)
class FutureSnapshot:
    showtime_ids: set[int]
    movie_ids: set[int]


@dataclass(frozen=True)
class ScrapeRunDetail:
    source_stream: str
    status: str
    started_at: datetime
    finished_at: datetime | None
    duration_seconds: float | None
    observed_showtime_count: int | None
    error: str | None


@dataclass(frozen=True)
class PresenceHealthSnapshot:
    active_presence_count: int
    inactive_presence_count: int
    pending_delete_count: int
    pending_delete_by_stream: list[tuple[str, int]]


@dataclass(frozen=True)
class Letterboxd403Diagnostics:
    observed_403_events: int
    unique_tmdb_ids: int
    probable_automated_block_events: int
    cooldown_events: int
    session_refresh_errors: int
    session_refresh_http_errors: int
    unique_cf_rays: int
    sample_cf_rays: list[str]


@dataclass
class _ShowtimeSourceFlags:
    showtime_id: int
    movie_title: str
    cinema_id: int
    datetime: datetime
    has_cineville_source: bool = False
    has_cinema_scraper_source: bool = False


def _normalize_title_for_conflict_match(title: str) -> str:
    cleaned = clean_title(title)
    folded = unicodedata.normalize("NFKD", cleaned)
    ascii_only = "".join(ch for ch in folded if not unicodedata.combining(ch))
    normalized = TITLE_NORMALIZE_PATTERN.sub(" ", ascii_only.lower())
    return re.sub(r"\s+", " ", normalized).strip()


def _titles_conflict_match(left_title: str, right_title: str) -> bool:
    left = _normalize_title_for_conflict_match(left_title)
    right = _normalize_title_for_conflict_match(right_title)
    if not left or not right:
        return False
    if left == right:
        return True

    left_tokens = set(left.split())
    right_tokens = set(right.split())
    if not left_tokens or not right_tokens:
        return False

    if len(left_tokens) > 1 and len(right_tokens) > 1:
        if left_tokens.issubset(right_tokens) or right_tokens.issubset(left_tokens):
            return True
        similarity = max(
            float(fuzz.token_set_ratio(left, right)),
            float(fuzz.ratio(left, right)),
        )
        return similarity >= TITLE_SIMILARITY_THRESHOLD

    similarity = max(
        float(fuzz.token_sort_ratio(left, right)),
        float(fuzz.ratio(left, right)),
    )
    return similarity >= SINGLE_TOKEN_SIMILARITY_THRESHOLD


def _delete_cineville_title_conflicts(*, session: Session) -> list[DeletedShowtimeInfo]:
    stmt = (
        select(
            ShowtimeSourcePresence,
            Showtime,
            Movie,
        )
        .select_from(ShowtimeSourcePresence)
        .join(
            Showtime,
            col(Showtime.id) == col(ShowtimeSourcePresence.showtime_id),
        )
        .join(
            Movie,
            col(Movie.id) == col(Showtime.movie_id),
        )
        .where(
            col(ShowtimeSourcePresence.active).is_(True),
            Showtime.datetime >= now_amsterdam_naive(),
        )
    )
    rows = list(session.exec(stmt).all())
    if not rows:
        return []

    showtimes: dict[int, _ShowtimeSourceFlags] = {}
    showtimes_by_slot: defaultdict[tuple[int, datetime], list[int]] = defaultdict(list)

    for presence, showtime, movie in rows:
        source_stream = presence.source_stream
        if not source_stream.startswith(
            (CINEVILLE_STREAM_PREFIX, CINEMA_SCRAPER_STREAM_PREFIX)
        ):
            continue
        showtime_id = showtime.id
        existing = showtimes.get(showtime_id)
        if existing is None:
            existing = _ShowtimeSourceFlags(
                showtime_id=int(showtime_id),
                movie_title=str(movie.title),
                cinema_id=int(showtime.cinema_id),
                datetime=showtime.datetime,
            )
            showtimes[showtime_id] = existing
            showtimes_by_slot[(existing.cinema_id, existing.datetime)].append(
                showtime_id
            )

        if source_stream.startswith(CINEVILLE_STREAM_PREFIX):
            existing.has_cineville_source = True
        if source_stream.startswith(CINEMA_SCRAPER_STREAM_PREFIX):
            existing.has_cinema_scraper_source = True

    ids_to_delete: set[int] = set()
    for slot_showtime_ids in showtimes_by_slot.values():
        cinema_scraper_showtimes = [
            showtimes[showtime_id]
            for showtime_id in slot_showtime_ids
            if showtimes[showtime_id].has_cinema_scraper_source
        ]
        if not cinema_scraper_showtimes:
            continue

        for showtime_id in slot_showtime_ids:
            candidate = showtimes[showtime_id]
            if not candidate.has_cineville_source:
                continue
            if candidate.has_cinema_scraper_source:
                continue

            if any(
                _titles_conflict_match(candidate.movie_title, other.movie_title)
                for other in cinema_scraper_showtimes
            ):
                ids_to_delete.add(candidate.showtime_id)

    if not ids_to_delete:
        return []

    deleted_showtimes = list(
        session.exec(select(Showtime).where(col(Showtime.id).in_(ids_to_delete))).all()
    )
    deleted_infos = [
        DeletedShowtimeInfo(
            showtime_id=showtime.id,
            movie_id=showtime.movie_id,
            movie_title=showtime.movie.title,
            cinema_id=showtime.cinema_id,
            cinema_name=showtime.cinema.name,
            datetime=showtime.datetime,
            ticket_link=showtime.ticket_link,
        )
        for showtime in deleted_showtimes
    ]
    session.execute(delete(Showtime).where(col(Showtime.id).in_(ids_to_delete)))
    session.commit()
    return deleted_infos


def _combine_summaries(
    *,
    current: ScrapeExecutionSummary,
    new: ScrapeExecutionSummary,
) -> ScrapeExecutionSummary:
    current.deleted_showtimes.extend(new.deleted_showtimes)
    current.errors.extend(new.errors)
    current.missing_cinemas.extend(new.missing_cinemas)
    current.missing_cinema_insert_failures.extend(new.missing_cinema_insert_failures)
    return current


def _dedupe_deleted_showtimes(
    deleted_showtimes: list[DeletedShowtimeInfo],
) -> list[DeletedShowtimeInfo]:
    by_id: dict[int, DeletedShowtimeInfo] = {}
    for deleted_showtime in deleted_showtimes:
        by_id[deleted_showtime.showtime_id] = deleted_showtime
    return list(by_id.values())


def _load_scrape_run_errors(
    *,
    started_at,
    finished_at,
) -> list[str]:
    try:
        with get_db_context() as session:
            stmt = (
                select(ScrapeRun)
                .where(
                    ScrapeRun.started_at >= started_at,
                    ScrapeRun.started_at <= finished_at,
                    col(ScrapeRun.status).in_(
                        [ScrapeRunStatus.FAILED, ScrapeRunStatus.DEGRADED]
                    ),
                )
                .order_by(col(ScrapeRun.started_at).asc())
            )
            rows = list(session.exec(stmt).all())
    except Exception as e:
        logger.error(f"Failed to load scrape-run errors for recap email. Error: {e}")
        return []
    return [
        f"{row.started_at.isoformat()} [{row.status.value}] {row.source_stream}: {row.error or 'unknown error'}"
        for row in rows
    ]


def _load_future_snapshot(*, snapshot_time) -> FutureSnapshot:
    try:
        with get_db_context() as session:
            rows = list(
                session.exec(
                    select(Showtime.id, Showtime.movie_id).where(
                        Showtime.datetime >= snapshot_time
                    )
                ).all()
            )
    except Exception as e:
        logger.error(f"Failed to load future snapshot. Error: {e}")
        return FutureSnapshot(showtime_ids=set(), movie_ids=set())

    showtime_ids = {int(showtime_id) for showtime_id, _ in rows}
    movie_ids = {int(movie_id) for _, movie_id in rows}
    return FutureSnapshot(showtime_ids=showtime_ids, movie_ids=movie_ids)


def _load_movie_labels(movie_ids: set[int]) -> list[str]:
    if not movie_ids:
        return []
    try:
        with get_db_context() as session:
            rows = list(
                session.exec(select(Movie).where(col(Movie.id).in_(movie_ids))).all()
            )
    except Exception as e:
        logger.error(f"Failed to load movie labels for recap. Error: {e}")
        return []
    labels = [f"{movie.title} (id={movie.id})" for movie in rows]
    labels.sort()
    return labels


def _status_key(status: Any) -> str:
    if isinstance(status, ScrapeRunStatus):
        return status.value
    return str(status)


def _load_scrape_run_details(
    *,
    started_at,
    finished_at,
) -> list[ScrapeRunDetail]:
    try:
        with get_db_context() as session:
            rows = list(
                session.exec(
                    select(ScrapeRun).where(
                        ScrapeRun.started_at >= started_at,
                        ScrapeRun.started_at <= finished_at,
                    )
                ).all()
            )
    except Exception as e:
        logger.error(f"Failed to load scrape-run details. Error: {e}")
        return []

    details: list[ScrapeRunDetail] = []
    for row in rows:
        duration_seconds: float | None = None
        if row.finished_at is not None:
            duration_seconds = max(
                0.0,
                (row.finished_at - row.started_at).total_seconds(),
            )
        details.append(
            ScrapeRunDetail(
                source_stream=row.source_stream,
                status=_status_key(row.status),
                started_at=row.started_at,
                finished_at=row.finished_at,
                duration_seconds=duration_seconds,
                observed_showtime_count=row.observed_showtime_count,
                error=row.error,
            )
        )
    details.sort(key=lambda detail: detail.started_at)
    return details


def _load_cinema_name_by_id() -> dict[int, str]:
    try:
        with get_db_context() as session:
            rows = list(session.exec(select(Cinema.id, Cinema.name)).all())
    except Exception as e:
        logger.error(f"Failed to load cinema names for recap. Error: {e}")
        return {}
    return {int(cinema_id): str(cinema_name) for cinema_id, cinema_name in rows}


def _stream_display_name(source_stream: str, cinema_name_by_id: dict[int, str]) -> str:
    if not source_stream.startswith("cinema_scraper:"):
        return source_stream
    _, _, suffix = source_stream.partition(":")
    if not suffix.isdigit():
        return source_stream
    cinema_id = int(suffix)
    cinema_name = cinema_name_by_id.get(cinema_id)
    if cinema_name is None:
        return source_stream
    return f"{source_stream} ({cinema_name})"


def _load_presence_health_snapshot() -> PresenceHealthSnapshot:
    threshold_minus_one = max(0, scrape_sync_service.MISSING_STREAK_TO_DEACTIVATE - 1)
    try:
        with get_db_context() as session:
            active_presence_count = int(
                session.exec(
                    select(func.count(col(ShowtimeSourcePresence.id))).where(
                        col(ShowtimeSourcePresence.active).is_(True)
                    )
                ).one()
                or 0
            )
            inactive_presence_count = int(
                session.exec(
                    select(func.count(col(ShowtimeSourcePresence.id))).where(
                        col(ShowtimeSourcePresence.active).is_(False)
                    )
                ).one()
                or 0
            )
            pending_rows = list(
                session.exec(
                    select(
                        ShowtimeSourcePresence.source_stream,
                        func.count(col(ShowtimeSourcePresence.id)),
                    )
                    .where(
                        col(ShowtimeSourcePresence.active).is_(True),
                        ShowtimeSourcePresence.missing_streak == threshold_minus_one,
                    )
                    .group_by(ShowtimeSourcePresence.source_stream)
                ).all()
            )
    except Exception as e:
        logger.error(f"Failed to load source-presence health snapshot. Error: {e}")
        return PresenceHealthSnapshot(
            active_presence_count=0,
            inactive_presence_count=0,
            pending_delete_count=0,
            pending_delete_by_stream=[],
        )

    pending_by_stream: list[tuple[str, int]] = [
        (str(source_stream), int(count_value))
        for source_stream, count_value in pending_rows
    ]
    pending_by_stream.sort(key=lambda item: (-item[1], item[0]))
    pending_delete_count = sum(count for _, count in pending_by_stream)
    return PresenceHealthSnapshot(
        active_presence_count=active_presence_count,
        inactive_presence_count=inactive_presence_count,
        pending_delete_count=pending_delete_count,
        pending_delete_by_stream=pending_by_stream,
    )


def _tmdb_miss_title_counts(tmdb_misses: list[dict[str, Any]]) -> list[tuple[str, int]]:
    counts: dict[str, int] = {}
    for miss in tmdb_misses:
        payload = miss.get("payload")
        if isinstance(payload, dict):
            raw_title = payload.get("title_query")
            title = str(raw_title).strip() if raw_title is not None else "<unknown>"
        else:
            title = "<unknown>"
        if not title:
            title = "<unknown>"
        counts[title] = counts.get(title, 0) + 1
    ranked = sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    return ranked


def _tmdb_low_confidence_lookups(
    tmdb_lookups: list[dict[str, Any]],
    *,
    threshold: float,
) -> list[dict[str, Any]]:
    low_confidence: list[dict[str, Any]] = []
    for lookup in tmdb_lookups:
        if lookup.get("tmdb_id") is None:
            continue
        confidence_raw = lookup.get("confidence")
        if isinstance(confidence_raw, int | float):
            confidence = float(confidence_raw)
        elif isinstance(confidence_raw, str):
            try:
                confidence = float(confidence_raw)
            except ValueError:
                continue
        else:
            continue
        if confidence >= threshold:
            continue
        enriched_lookup = dict(lookup)
        enriched_lookup["confidence"] = confidence
        low_confidence.append(enriched_lookup)
    return sorted(
        low_confidence,
        key=lambda item: (
            float(item.get("confidence", 0.0)),
            str(item.get("timestamp", "")),
        ),
    )


def _error_stage_counts(errors: list[str]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for error in errors:
        match = STAGE_PATTERN.search(error)
        stage = "unknown"
        if match is not None:
            stage = match.group(2).strip()
        counts[stage] = counts.get(stage, 0) + 1
    return counts


def _tmdb_cache_breakdown(tmdb_lookups: list[dict[str, Any]]) -> dict[str, int]:
    counts = {
        "memory": 0,
        "database": 0,
        "singleflight": 0,
        "network": 0,
        "unknown": 0,
    }
    for lookup in tmdb_lookups:
        source_value = lookup.get("cache_source")
        source = str(source_value) if source_value is not None else "unknown"
        if source not in counts:
            source = "unknown"
        counts[source] += 1
    return counts


def _letterboxd_failure_breakdown(
    letterboxd_failures: list[dict[str, Any]],
) -> dict[str, int]:
    counts: dict[str, int] = {}
    for failure in letterboxd_failures:
        event_type_raw = failure.get("event_type")
        event_type = (
            str(event_type_raw).strip()
            if event_type_raw is not None
            else "unknown_failure"
        )
        if not event_type:
            event_type = "unknown_failure"
        counts[event_type] = counts.get(event_type, 0) + 1
    return counts


def _letterboxd_403_diagnostics(
    letterboxd_failures: list[dict[str, Any]],
) -> Letterboxd403Diagnostics:
    observed_403_events = 0
    unique_tmdb_ids: set[int] = set()
    probable_automated_block_events = 0
    cooldown_events = 0
    session_refresh_errors = 0
    session_refresh_http_errors = 0
    cf_rays: set[str] = set()

    for failure in letterboxd_failures:
        status_code = failure.get("status_code")
        event_type = str(failure.get("event_type") or "").strip()
        reason = str(failure.get("reason") or "").strip()

        if status_code == 403 or event_type.startswith("http_403"):
            observed_403_events += 1
            tmdb_id_raw = failure.get("tmdb_id")
            if isinstance(tmdb_id_raw, int):
                unique_tmdb_ids.add(tmdb_id_raw)
            elif isinstance(tmdb_id_raw, str) and tmdb_id_raw.isdigit():
                unique_tmdb_ids.add(int(tmdb_id_raw))

        if "probable_automated_block" in reason or event_type in {
            "cloudflare_challenge",
            "http_403_block",
            "http_403_streak_block",
        }:
            probable_automated_block_events += 1

        if event_type in {
            "cooldown_skip",
            "cloudflare_challenge",
            "rate_limited",
            "http_403_block",
            "http_403_streak_block",
        }:
            cooldown_events += 1

        if event_type == "session_refresh_error":
            session_refresh_errors += 1
        if event_type == "session_refresh_http_error":
            session_refresh_http_errors += 1

        response_meta_raw = failure.get("response_meta")
        if isinstance(response_meta_raw, dict):
            cf_ray_raw = response_meta_raw.get("cf_ray")
            if cf_ray_raw is not None:
                cf_ray = str(cf_ray_raw).strip()
                if cf_ray:
                    cf_rays.add(cf_ray)

    sample_cf_rays = sorted(cf_rays)[:8]
    return Letterboxd403Diagnostics(
        observed_403_events=observed_403_events,
        unique_tmdb_ids=len(unique_tmdb_ids),
        probable_automated_block_events=probable_automated_block_events,
        cooldown_events=cooldown_events,
        session_refresh_errors=session_refresh_errors,
        session_refresh_http_errors=session_refresh_http_errors,
        unique_cf_rays=len(cf_rays),
        sample_cf_rays=sample_cf_rays,
    )


def _render_letterboxd_failure_item(failure: dict[str, Any]) -> str:
    parts: list[str] = []
    parts.append(str(failure.get("timestamp", "unknown_time")))
    parts.append(f"event={failure.get('event_type', 'unknown_failure')}")
    if failure.get("tmdb_id") is not None:
        parts.append(f"tmdb_id={failure.get('tmdb_id')}")
    if failure.get("status_code") is not None:
        parts.append(f"status={failure.get('status_code')}")
    if failure.get("reason") is not None:
        parts.append(f"reason={failure.get('reason')}")
    if failure.get("url") is not None:
        parts.append(f"url={failure.get('url')}")

    response_meta_raw = failure.get("response_meta")
    if isinstance(response_meta_raw, dict):
        cf_ray = response_meta_raw.get("cf_ray")
        if cf_ray:
            parts.append(f"cf_ray={cf_ray}")
        server = response_meta_raw.get("server")
        if server:
            parts.append(f"server={server}")
        consecutive_403_count = response_meta_raw.get("consecutive_403_count")
        if consecutive_403_count is not None:
            parts.append(f"consecutive_403={consecutive_403_count}")
        attempt = response_meta_raw.get("attempt")
        attempts_total = response_meta_raw.get("attempts_total")
        if attempt is not None and attempts_total is not None:
            parts.append(f"attempt={attempt}/{attempts_total}")

    block_remaining_seconds = failure.get("block_remaining_seconds")
    if block_remaining_seconds is not None:
        parts.append(f"cooldown_remaining={block_remaining_seconds}s")

    return "<li>" + escape(" | ".join(parts)) + "</li>"


def _render_low_confidence_tmdb_item(item: dict[str, Any]) -> str:
    payload_raw = item.get("payload")
    payload: dict[str, Any] = payload_raw if isinstance(payload_raw, dict) else {}
    decision_raw = item.get("decision")
    decision: dict[str, Any] = decision_raw if isinstance(decision_raw, dict) else {}
    tmdb_id_raw = item.get("tmdb_id")
    tmdb_link = None
    if isinstance(tmdb_id_raw, int) or (
        isinstance(tmdb_id_raw, str) and tmdb_id_raw.isdigit()
    ):
        tmdb_link = f"https://www.themoviedb.org/movie/{tmdb_id_raw}"

    reason = str(decision.get("reason", "selected_best_candidate"))
    reason_text = {
        "selected_best_candidate": "best candidate selected",
        "ambiguous_good_options": "selected despite close alternatives",
    }.get(reason, reason.replace("_", " "))
    best_raw = decision.get("best")
    best: dict[str, Any] = best_raw if isinstance(best_raw, dict) else {}
    best_title = str(best.get("title", "")).strip()
    best_year = best.get("release_year")
    best_summary = ""
    if best_title:
        best_summary = f" | best={escape(best_title)}"
        if isinstance(best_year, int):
            best_summary += f" ({best_year})"

    directors_raw = payload.get("director_names")
    directors = directors_raw if isinstance(directors_raw, list) else []
    actors_raw = payload.get("actor_names")
    actors = actors_raw if isinstance(actors_raw, list) else []
    year_raw = payload.get("year")
    duration_raw = payload.get("duration_minutes")
    langs_raw = payload.get("spoken_languages")
    langs = langs_raw if isinstance(langs_raw, list) else []

    line = (
        f"{escape(str(item.get('timestamp', 'unknown_time')))} | "
        f"title={escape(str(payload.get('title_query', '<unknown>')))} | "
        f"tmdb_id={escape(str(tmdb_id_raw))} | "
        f"confidence=<b>{float(item.get('confidence', 0.0)):.1f}</b> | "
        f"reason={escape(reason_text)}"
        f"{best_summary} | "
        f"cache={escape(str(item.get('cache_source', 'unknown')))}"
    )
    if tmdb_link is not None:
        line += f' | <a href="{escape(tmdb_link, quote=True)}">tmdb page</a>'
    query_info = (
        "query="
        f"{escape(str(payload.get('title_query', '<unknown>')))} | "
        f"directors={escape(', '.join(str(name) for name in directors) or '-')} | "
        f"actors={escape(', '.join(str(name) for name in actors[:5]) or '-')} | "
        f"year={escape(str(year_raw if year_raw is not None else '-'))} | "
        f"duration={escape(str(duration_raw if duration_raw is not None else '-'))} | "
        f"languages={escape(', '.join(str(code) for code in langs) or '-')}"
    )
    return "<li>" + line + f"<br/>{query_info}</li>"


def _render_tmdb_miss_item(item: dict[str, Any]) -> str:
    payload_raw = item.get("payload")
    payload: dict[str, Any] = payload_raw if isinstance(payload_raw, dict) else {}
    decision_raw = item.get("decision")
    decision: dict[str, Any] = decision_raw if isinstance(decision_raw, dict) else {}
    reason = str(decision.get("reason", "unknown"))
    reason_text = {
        "no_candidates": "no TMDB candidates",
        "no_scored_candidates": "no usable candidates after scoring",
        "insufficient_evidence": "insufficient evidence",
        "ambiguous_good_options": "ambiguous between good options",
        "invalid_best_candidate": "invalid best candidate",
    }.get(reason, reason.replace("_", " "))

    directors_raw = payload.get("director_names")
    directors = directors_raw if isinstance(directors_raw, list) else []
    actors_raw = payload.get("actor_names")
    actors = actors_raw if isinstance(actors_raw, list) else []
    year_raw = payload.get("year")
    duration_raw = payload.get("duration_minutes")
    langs_raw = payload.get("spoken_languages")
    langs = langs_raw if isinstance(langs_raw, list) else []

    line = (
        f"{escape(str(item.get('timestamp', 'unknown_time')))} | "
        f"title={escape(str(payload.get('title_query', '<unknown>')))} | "
        f"reason={escape(reason_text)} | "
        f"cache={escape(str(item.get('cache_source', 'unknown')))}"
    )
    query_info = (
        "query="
        f"{escape(str(payload.get('title_query', '<unknown>')))} | "
        f"directors={escape(', '.join(str(name) for name in directors) or '-')} | "
        f"actors={escape(', '.join(str(name) for name in actors[:5]) or '-')} | "
        f"year={escape(str(year_raw if year_raw is not None else '-'))} | "
        f"duration={escape(str(duration_raw if duration_raw is not None else '-'))} | "
        f"languages={escape(', '.join(str(code) for code in langs) or '-')}"
    )
    return "<li>" + line + f"<br/>{query_info}</li>"


def _compact_json_bytes(payload: Any) -> bytes:
    return json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")


def _tmdb_resolution_audit_dir() -> Path:
    return Path(__file__).resolve().parents[2] / TMDB_RESOLUTION_AUDIT_DIR_NAME


def _tmdb_fixture_source_of_truth_path() -> Path:
    return (
        Path(__file__).resolve().parents[2]
        / "tests"
        / "fixtures"
        / "tmdb_resolution_cases.json"
    )


def _safe_int_or_none(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _safe_float_or_none(value: Any) -> float | None:
    if isinstance(value, int | float):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def _lookup_payload_key(lookup: dict[str, Any]) -> str | None:
    payload_raw = lookup.get("payload")
    payload: dict[str, Any] = payload_raw if isinstance(payload_raw, dict) else {}
    title_query_raw = payload.get("title_query")
    title_query = str(title_query_raw).strip() if title_query_raw is not None else ""
    if not title_query:
        return None
    key_payload = {
        "title_query": title_query,
        "director_names": _string_list(payload.get("director_names")),
        "actor_names": _string_list(payload.get("actor_names")),
        "year": _safe_int_or_none(payload.get("year")),
        "duration_minutes": _safe_int_or_none(payload.get("duration_minutes")),
        "spoken_languages": _string_list(payload.get("spoken_languages")),
    }
    return json.dumps(
        key_payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True
    )


def _lookup_diagnostic_richness(lookup: dict[str, Any]) -> tuple[int, int]:
    decision_raw = lookup.get("decision")
    decision: dict[str, Any] = decision_raw if isinstance(decision_raw, dict) else {}
    trace_raw = decision.get("trace")
    trace: dict[str, Any] = trace_raw if isinstance(trace_raw, dict) else {}
    candidates_raw = trace.get("candidates")
    candidates = candidates_raw if isinstance(candidates_raw, list) else []
    confidence_value = _safe_float_or_none(lookup.get("confidence"))
    if confidence_value is None:
        confidence_bucket = -1
    else:
        confidence_bucket = int(confidence_value)

    score = 0
    if candidates:
        score += 3
    if decision.get("winner_quality") is not None:
        score += 2
    if lookup.get("cache_source") == "network":
        score += 1
    return score, confidence_bucket


def _dedupe_tmdb_lookups_for_reporting(
    tmdb_lookups: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    by_key: dict[str, dict[str, Any]] = {}
    for lookup in tmdb_lookups:
        key = _lookup_payload_key(lookup)
        if key is None:
            continue
        existing = by_key.get(key)
        if existing is None:
            by_key[key] = lookup
            continue
        if _lookup_diagnostic_richness(lookup) > _lookup_diagnostic_richness(existing):
            by_key[key] = lookup
    return list(by_key.values())


def _lookup_is_perfect_match(lookup: dict[str, Any]) -> bool:
    decision_raw = lookup.get("decision")
    decision: dict[str, Any] = decision_raw if isinstance(decision_raw, dict) else {}
    winner_quality_raw = decision.get("winner_quality")
    if isinstance(winner_quality_raw, str) and winner_quality_raw.upper() == "PERFECT":
        return True
    confidence_value = _safe_float_or_none(lookup.get("confidence"))
    if confidence_value is None:
        return False
    return confidence_value >= 99.0


def _lookup_worst_to_best_rank(lookup: dict[str, Any]) -> int:
    if _safe_int_or_none(lookup.get("tmdb_id")) is None:
        return 0

    decision_raw = lookup.get("decision")
    decision: dict[str, Any] = decision_raw if isinstance(decision_raw, dict) else {}
    winner_quality_raw = decision.get("winner_quality")
    winner_quality = (
        str(winner_quality_raw).upper() if winner_quality_raw is not None else ""
    )
    winner_quality_ranks = {
        "POOR": 1,
        "DECENT": 2,
        "GOOD": 3,
        "EXCELLENT": 4,
        "PERFECT": 5,
    }
    if winner_quality in winner_quality_ranks:
        return winner_quality_ranks[winner_quality]

    confidence = _safe_float_or_none(lookup.get("confidence"))
    if confidence is None:
        return 3
    if confidence < 55.0:
        return 1
    if confidence < 70.0:
        return 2
    if confidence < 90.0:
        return 3
    if confidence < 99.0:
        return 4
    return 5


def _sorted_tmdb_lookups_for_markdown(
    tmdb_lookups: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    deduped = _dedupe_tmdb_lookups_for_reporting(tmdb_lookups)
    filtered = [lookup for lookup in deduped if not _lookup_is_perfect_match(lookup)]

    def sort_key(lookup: dict[str, Any]) -> tuple[int, float, str]:
        rank = _lookup_worst_to_best_rank(lookup)
        confidence = _safe_float_or_none(lookup.get("confidence"))
        if confidence is None:
            confidence = -1.0
        payload_raw = lookup.get("payload")
        payload: dict[str, Any] = payload_raw if isinstance(payload_raw, dict) else {}
        title_query_raw = payload.get("title_query")
        title_query = (
            str(title_query_raw).lower() if title_query_raw is not None else ""
        )
        return rank, confidence, title_query

    return sorted(filtered, key=sort_key)


def _build_tmdb_fixture_json(
    *,
    started_at: datetime,
    tmdb_lookups: list[dict[str, Any]],
) -> dict[str, Any]:
    deduped = _dedupe_tmdb_lookups_for_reporting(tmdb_lookups)
    cases: list[dict[str, Any]] = []
    for index, lookup in enumerate(deduped, start=1):
        payload_raw = lookup.get("payload")
        payload: dict[str, Any] = payload_raw if isinstance(payload_raw, dict) else {}
        title_query_raw = payload.get("title_query")
        title_query = (
            str(title_query_raw).strip() if title_query_raw is not None else ""
        )
        if not title_query:
            continue

        actor_names = _string_list(payload.get("actor_names"))
        actor_name = actor_names[0] if actor_names else None
        input_payload = {
            "title_query": title_query,
            "director_names": _string_list(payload.get("director_names")),
            "actor_name": actor_name,
            "year": _safe_int_or_none(payload.get("year")),
            "duration_minutes": _safe_int_or_none(payload.get("duration_minutes")),
            "spoken_languages": _string_list(payload.get("spoken_languages")),
        }
        case_slug = TITLE_NORMALIZE_PATTERN.sub("_", title_query.lower()).strip("_")
        case_name = f"{index:04d}_{case_slug or 'untitled'}"
        cases.append(
            {
                "name": case_name,
                "input": input_payload,
                "expected": {
                    "tmdb_id": _safe_int_or_none(lookup.get("tmdb_id")),
                },
            }
        )

    return {
        "description": (
            "Fixture cases generated from scraper TMDB resolution events. "
            "Set RUN_LIVE_TMDB_RESOLUTION_CASES=1 to execute live TMDB assertions."
        ),
        "generated_at": started_at.isoformat(),
        "total_cases": len(cases),
        "cases": cases,
    }


def _render_candidate_trace_lines(candidate: dict[str, Any]) -> list[str]:
    movie_id = candidate.get("id")
    title = str(candidate.get("title", "<unknown>"))
    buckets_raw = candidate.get("source_buckets")
    buckets = buckets_raw if isinstance(buckets_raw, list) else []
    pre_raw = candidate.get("pre")
    pre: dict[str, Any] = pre_raw if isinstance(pre_raw, dict) else {}
    post_raw = candidate.get("post")
    post: dict[str, Any] = post_raw if isinstance(post_raw, dict) else {}
    enrichment_raw = candidate.get("enrichment")
    enrichment: dict[str, Any] = (
        enrichment_raw if isinstance(enrichment_raw, dict) else {}
    )
    details_raw = candidate.get("details")
    details: dict[str, Any] = details_raw if isinstance(details_raw, dict) else {}

    lines = [
        f"- id={movie_id} | title={title} | buckets={', '.join(str(b) for b in buckets) or '-'}",
        "  pre: "
        f"source={pre.get('source_quality')} | "
        f"title={pre.get('title_quality')} | "
        f"year={pre.get('year_quality')} | "
        f"language={pre.get('language_quality')} | "
        f"overall={pre.get('overall_quality')}",
        "  post: "
        f"overall={post.get('overall_quality')} | "
        f"rank={post.get('rank')}",
    ]
    if enrichment:
        lines.append(
            "  enrichment: "
            f"runtime={enrichment.get('runtime_quality')} | "
            f"language={enrichment.get('language_quality')} | "
            f"director={enrichment.get('director_quality')} | "
            f"actor={enrichment.get('actor_quality')} | "
            f"contradiction={enrichment.get('has_contradiction')} | "
            f"strong_support_count={enrichment.get('strong_support_count')} | "
            f"has_viable_higher_option={enrichment.get('has_viable_higher_option')}"
        )
    if details:
        lines.append(
            "  details: "
            f"runtime={details.get('runtime_minutes')} | "
            f"is_short={details.get('is_short')} | "
            f"is_documentary={details.get('is_documentary')} | "
            f"genre_ids={details.get('genre_ids')} | "
            f"original_language={details.get('original_language')} | "
            f"spoken_languages={details.get('spoken_languages')}"
        )
    return lines


def _build_tmdb_resolution_audit_markdown(
    *,
    started_at: datetime,
    tmdb_lookups: list[dict[str, Any]],
) -> str:
    markdown_lookups = _sorted_tmdb_lookups_for_markdown(tmdb_lookups)
    lines: list[str] = [
        "# TMDB Resolution Audit",
        "",
        f"Started at: {started_at.isoformat()}",
        f"Total lookups: {len(tmdb_lookups)}",
        f"Included in markdown (non-perfect, deduped): {len(markdown_lookups)}",
        "Order: worst to best (not found first).",
        f"Candidate options shown per lookup: top {TMDB_MARKDOWN_CANDIDATE_LIMIT}.",
        "",
    ]

    for index, lookup in enumerate(markdown_lookups, start=1):
        payload_raw = lookup.get("payload")
        payload: dict[str, Any] = payload_raw if isinstance(payload_raw, dict) else {}
        decision_raw = lookup.get("decision")
        decision: dict[str, Any] = (
            decision_raw if isinstance(decision_raw, dict) else {}
        )
        trace_raw = decision.get("trace")
        trace: dict[str, Any] = trace_raw if isinstance(trace_raw, dict) else {}
        candidates_raw = trace.get("candidates")
        candidates = candidates_raw if isinstance(candidates_raw, list) else []

        lines.extend(
            [
                f"## {index}. {payload.get('title_query', '<unknown title>')}",
                f"- timestamp: {lookup.get('timestamp')}",
                f"- tmdb_id: {lookup.get('tmdb_id')}",
                f"- confidence: {lookup.get('confidence')}",
                f"- cache: {lookup.get('cache_source')} (hit={lookup.get('cache_hit')})",
                f"- status: {decision.get('status')}",
                f"- reason: {decision.get('reason')}",
                f"- winner_id: {decision.get('winner_id')}",
                f"- winner_quality: {decision.get('winner_quality')}",
                f"- enrichment_requested: {trace.get('enrichment_requested')}",
                f"- enrichment_candidate_ids: {trace.get('enrichment_candidate_ids')}",
                "- query:",
                f"  - title_query: {payload.get('title_query')}",
                f"  - director_names: {payload.get('director_names')}",
                f"  - actor_names: {payload.get('actor_names')}",
                f"  - year: {payload.get('year')}",
                f"  - duration_minutes: {payload.get('duration_minutes')}",
                f"  - spoken_languages: {payload.get('spoken_languages')}",
                "- candidates:",
            ]
        )
        if not candidates:
            lines.append("  - none")
        else:
            displayed_candidates = candidates[:TMDB_MARKDOWN_CANDIDATE_LIMIT]
            for candidate_raw in displayed_candidates:
                candidate = candidate_raw if isinstance(candidate_raw, dict) else {}
                lines.extend(_render_candidate_trace_lines(candidate))
            omitted = len(candidates) - len(displayed_candidates)
            if omitted > 0:
                lines.append(f"  - ... {omitted} additional candidate(s) omitted")
        lines.append("")

    return "\n".join(lines)


def _write_tmdb_resolution_audit_files(
    *,
    started_at: datetime,
    tmdb_lookups: list[dict[str, Any]],
) -> list[Path]:
    output_dir = _tmdb_resolution_audit_dir()
    output_dir.mkdir(parents=True, exist_ok=True)
    suffix = started_at.strftime("%Y%m%d_%H%M%S")

    json_path = output_dir / f"tmdb_resolution_audit_{suffix}.json"
    markdown_path = output_dir / f"tmdb_resolution_audit_{suffix}.md"

    json_payload = _build_tmdb_fixture_json(
        started_at=started_at,
        tmdb_lookups=tmdb_lookups,
    )
    json_path.write_text(
        json.dumps(json_payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    markdown_path.write_text(
        _build_tmdb_resolution_audit_markdown(
            started_at=started_at,
            tmdb_lookups=tmdb_lookups,
        ),
        encoding="utf-8",
    )
    return [json_path, markdown_path]


def _tmdb_fixture_cases(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, dict):
        raw_cases = payload.get("cases")
    elif isinstance(payload, list):
        raw_cases = payload
    else:
        return []
    if not isinstance(raw_cases, list):
        return []
    return [case for case in raw_cases if isinstance(case, dict)]


def _dedupe_exact_tmdb_fixture_cases(
    cases: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    deduped: list[dict[str, Any]] = []
    seen: set[str] = set()
    for case in cases:
        key = json.dumps(
            case,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=True,
        )
        if key in seen:
            continue
        seen.add(key)
        deduped.append(case)
    return deduped


def _merge_generated_tmdb_fixture_into_source_of_truth(
    *,
    generated_json_path: Path,
    source_of_truth_path: Path,
) -> tuple[int, int, int]:
    generated_payload_raw: Any = {}
    try:
        generated_payload_raw = json.loads(
            generated_json_path.read_text(encoding="utf-8")
        )
    except Exception:
        logger.error(
            "Failed to parse generated TMDB fixture JSON: %s",
            generated_json_path,
            exc_info=True,
        )
        raise
    generated_cases = _tmdb_fixture_cases(generated_payload_raw)

    existing_payload_raw: Any = {}
    if source_of_truth_path.exists():
        try:
            existing_payload_raw = json.loads(
                source_of_truth_path.read_text(encoding="utf-8")
            )
        except Exception:
            logger.error(
                "Failed to parse TMDB fixture source of truth: %s",
                source_of_truth_path,
                exc_info=True,
            )
            raise
    existing_cases = _tmdb_fixture_cases(existing_payload_raw)

    merged_cases = _dedupe_exact_tmdb_fixture_cases([*existing_cases, *generated_cases])
    merged_payload = (
        dict(existing_payload_raw) if isinstance(existing_payload_raw, dict) else {}
    )
    generated_payload = (
        generated_payload_raw if isinstance(generated_payload_raw, dict) else {}
    )
    merged_payload["description"] = generated_payload.get(
        "description",
        merged_payload.get(
            "description",
            "Fixture cases generated from scraper TMDB resolution events.",
        ),
    )
    merged_payload["generated_at"] = generated_payload.get(
        "generated_at",
        now_amsterdam_naive().isoformat(),
    )
    merged_payload["total_cases"] = len(merged_cases)
    merged_payload["cases"] = merged_cases

    source_of_truth_path.parent.mkdir(parents=True, exist_ok=True)
    source_of_truth_path.write_text(
        json.dumps(merged_payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return len(existing_cases), len(generated_cases), len(merged_cases)


def _cleanup_tmdb_resolution_audit_files() -> list[Path]:
    output_dir = _tmdb_resolution_audit_dir()
    if not output_dir.exists():
        return []
    deleted_paths: list[Path] = []
    for pattern in ("tmdb_resolution_audit_*.json", "tmdb_resolution_audit_*.md"):
        for file_path in output_dir.glob(pattern):
            if not file_path.is_file():
                continue
            file_path.unlink(missing_ok=True)
            deleted_paths.append(file_path)
    return deleted_paths


def _compact_tmdb_lookup_for_attachment(lookup: dict[str, Any]) -> dict[str, Any]:
    payload_raw = lookup.get("payload")
    payload: dict[str, Any] = payload_raw if isinstance(payload_raw, dict) else {}
    decision_raw = lookup.get("decision")
    decision: dict[str, Any] = decision_raw if isinstance(decision_raw, dict) else {}
    best_raw = decision.get("best")
    best: dict[str, Any] = best_raw if isinstance(best_raw, dict) else {}
    return {
        "timestamp": lookup.get("timestamp"),
        "tmdb_id": lookup.get("tmdb_id"),
        "confidence": lookup.get("confidence"),
        "cache_source": lookup.get("cache_source"),
        "title_query": payload.get("title_query"),
        "director_names": payload.get("director_names"),
        "actor_names": payload.get("actor_names"),
        "year": payload.get("year"),
        "duration_minutes": payload.get("duration_minutes"),
        "spoken_languages": payload.get("spoken_languages"),
        "decision_status": decision.get("status"),
        "decision_reason": decision.get("reason"),
        "good_option_count": decision.get("good_option_count"),
        "best_margin": decision.get("best_margin"),
        "second_good_margin": decision.get("second_good_margin"),
        "best_tmdb_id": best.get("tmdb_id"),
        "best_title": best.get("title"),
        "best_release_year": best.get("release_year"),
    }


def _load_scrape_run_status_counts(
    *,
    started_at,
    finished_at,
) -> dict[str, int]:
    try:
        with get_db_context() as session:
            rows = list(
                session.exec(
                    select(ScrapeRun.status).where(
                        ScrapeRun.started_at >= started_at,
                        ScrapeRun.started_at <= finished_at,
                    )
                ).all()
            )
    except Exception as e:
        logger.error(f"Failed to load scrape-run status counts. Error: {e}")
        return {"success": 0, "degraded": 0, "failed": 0}
    counts = {"success": 0, "degraded": 0, "failed": 0}
    for status in rows:
        key = _status_key(status)
        counts[key] = counts.get(key, 0) + 1
    return counts


def _render_recap_html(
    *,
    started_at,
    finished_at,
    tmdb_lookups: list[dict],
    tmdb_misses: list[dict],
    letterboxd_failures: list[dict[str, Any]],
    deleted_showtimes: list[DeletedShowtimeInfo],
    errors: list[str],
    missing_cinemas: list[str],
    missing_cinema_insert_failures: list[str],
    new_future_showtime_count: int,
    new_future_movie_labels: list[str],
    future_showtime_count_before: int,
    future_showtime_count_after: int,
    future_movie_count_before: int,
    future_movie_count_after: int,
    tmdb_cache_counts: dict[str, int],
    scrape_status_counts: dict[str, int],
    scrape_run_details: list[ScrapeRunDetail],
    cinema_scraper_details: list[ScrapeRunDetail],
    cinema_scraper_status_counts: dict[str, int],
    cinema_name_by_id: dict[int, str],
    slowest_run_details: list[ScrapeRunDetail],
    presence_health: PresenceHealthSnapshot,
    tmdb_miss_titles: list[tuple[str, int]],
    low_confidence_lookups: list[dict[str, Any]],
    low_confidence_threshold: float,
    error_stage_counts: dict[str, int],
    letterboxd_failure_counts: dict[str, int],
    letterboxd_403_diagnostics: Letterboxd403Diagnostics,
) -> str:
    deleted_items = (
        "".join(
            "<li>"
            f"{escape(showtime.datetime.isoformat())} - "
            f"{escape(showtime.movie_title)} "
            f"@ {escape(showtime.cinema_name)} "
            f"(showtime_id={showtime.showtime_id}, movie_id={showtime.movie_id}, cinema_id={showtime.cinema_id})"
            "</li>"
            for showtime in deleted_showtimes
        )
        or "<li>None</li>"
    )

    tmdb_miss_items = (
        "".join(_render_tmdb_miss_item(item) for item in tmdb_misses[:200])
        or "<li>None</li>"
    )
    tmdb_miss_title_items = (
        "".join(
            f"<li>{escape(title)}: <b>{count}</b></li>"
            for title, count in tmdb_miss_titles[:25]
        )
        or "<li>None</li>"
    )
    low_confidence_items = (
        "".join(
            _render_low_confidence_tmdb_item(item)
            for item in low_confidence_lookups[:50]
        )
        or "<li>None</li>"
    )

    error_items = (
        "".join(f"<li>{escape(error)}</li>" for error in errors) or "<li>None</li>"
    )
    error_stage_items = (
        "".join(
            f"<li>{escape(stage)}: <b>{count}</b></li>"
            for stage, count in sorted(
                error_stage_counts.items(),
                key=lambda item: (-item[1], item[0]),
            )
        )
        or "<li>None</li>"
    )

    missing_cinema_items = (
        "".join(f"<li>{escape(cinema_name)}</li>" for cinema_name in missing_cinemas)
        or "<li>None</li>"
    )
    missing_cinema_insert_failure_items = (
        "".join(f"<li>{escape(item)}</li>" for item in missing_cinema_insert_failures)
        or "<li>None</li>"
    )

    new_movie_items = (
        "".join(f"<li>{escape(label)}</li>" for label in new_future_movie_labels[:50])
        or "<li>None</li>"
    )

    tmdb_cache_breakdown_items = "".join(
        f"<li>{escape(source)}: <b>{count}</b></li>"
        for source, count in sorted(tmdb_cache_counts.items())
    )
    tmdb_hit_count = sum(
        tmdb_cache_counts.get(key, 0) for key in ("memory", "database", "singleflight")
    )
    tmdb_hit_rate = (
        (tmdb_hit_count / len(tmdb_lookups)) * 100.0 if tmdb_lookups else 0.0
    )

    scrape_status_items = "".join(
        f"<li>{escape(status)}: <b>{count}</b></li>"
        for status, count in sorted(scrape_status_counts.items())
    )
    cinema_scraper_status_items = (
        "".join(
            f"<li>{escape(status)}: <b>{count}</b></li>"
            for status, count in sorted(cinema_scraper_status_counts.items())
        )
        or "<li>None</li>"
    )
    pending_delete_items = (
        "".join(
            f"<li>{escape(source_stream)}: <b>{count}</b></li>"
            for source_stream, count in presence_health.pending_delete_by_stream[:25]
        )
        or "<li>None</li>"
    )
    slowest_stream_items = (
        "".join(
            "<li>"
            f"{escape(detail.source_stream)} "
            f"[{escape(detail.status)}] "
            f"duration=<b>{detail.duration_seconds:.1f}s</b> "
            f"observed={detail.observed_showtime_count if detail.observed_showtime_count is not None else '-'}"
            "</li>"
            for detail in slowest_run_details
            if detail.duration_seconds is not None
        )
        or "<li>None</li>"
    )
    run_detail_items = (
        "".join(
            "<li>"
            f"{escape(detail.started_at.isoformat())} | "
            f"{escape(detail.source_stream)} | "
            f"status={escape(detail.status)} | "
            f"duration={f'{detail.duration_seconds:.1f}s' if detail.duration_seconds is not None else '-'} | "
            f"observed={detail.observed_showtime_count if detail.observed_showtime_count is not None else '-'}"
            + (f" | error={escape(detail.error)}" if detail.error else "")
            + "</li>"
            for detail in scrape_run_details
        )
        or "<li>None</li>"
    )
    cinema_scraper_detail_items = (
        "".join(
            "<li>"
            f"{escape(detail.started_at.isoformat())} | "
            f"{escape(_stream_display_name(detail.source_stream, cinema_name_by_id))} | "
            f"status={escape(detail.status)} | "
            f"duration={f'{detail.duration_seconds:.1f}s' if detail.duration_seconds is not None else '-'} | "
            f"observed={detail.observed_showtime_count if detail.observed_showtime_count is not None else '-'}"
            + (f" | error={escape(detail.error)}" if detail.error else "")
            + "</li>"
            for detail in cinema_scraper_details
        )
        or "<li>None</li>"
    )
    letterboxd_failure_items = (
        "".join(
            _render_letterboxd_failure_item(failure) for failure in letterboxd_failures
        )
        or "<li>None</li>"
    )
    letterboxd_failure_breakdown_items = (
        "".join(
            f"<li>{escape(event_type)}: <b>{count}</b></li>"
            for event_type, count in sorted(
                letterboxd_failure_counts.items(),
                key=lambda item: (-item[1], item[0]),
            )
        )
        or "<li>None</li>"
    )
    letterboxd_403_cf_ray_items = (
        "".join(
            f"<li><code>{escape(cf_ray)}</code></li>"
            for cf_ray in letterboxd_403_diagnostics.sample_cf_rays
        )
        or "<li>None</li>"
    )
    letterboxd_403_interpretation = "No 403 responses observed."
    if letterboxd_403_diagnostics.observed_403_events > 0:
        if letterboxd_403_diagnostics.cooldown_events > 0:
            letterboxd_403_interpretation = "Automated-block protections were triggered and cooldown mode was engaged."
        else:
            letterboxd_403_interpretation = "403 responses were observed without cooldown trigger; this usually indicates a short-lived edge/IP reputation block."

    return f"""
    <h2>Scrape Recap</h2>
    <p>Started: <code>{escape(started_at.isoformat())}</code></p>
    <p>Finished: <code>{escape(finished_at.isoformat())}</code></p>
    <p>Duration: <b>{(finished_at - started_at)}</b></p>
    <h3>Run Metrics</h3>
    <ul>
      <li>New future showtimes: <b>{new_future_showtime_count}</b></li>
      <li>New movies among future showtimes: <b>{len(new_future_movie_labels)}</b></li>
      <li>Future showtimes before run: <b>{future_showtime_count_before}</b></li>
      <li>Future showtimes after run: <b>{future_showtime_count_after}</b></li>
      <li>Future movies before run: <b>{future_movie_count_before}</b></li>
      <li>Future movies after run: <b>{future_movie_count_after}</b></li>
    </ul>
    <p>Total TMDB lookups sent: <b>{len(tmdb_lookups)}</b></p>
    <p>TMDB cache hit rate: <b>{tmdb_hit_rate:.1f}%</b></p>
    <p>TMDB ID not found count: <b>{len(tmdb_misses)}</b></p>
    <p>Low-confidence TMDB matches (&lt; {low_confidence_threshold:.1f}): <b>{len(low_confidence_lookups)}</b></p>
    <p>Future showtimes deleted (no longer found): <b>{len(deleted_showtimes)}</b></p>
    <p>Error count: <b>{len(errors)}</b></p>
    <p>Letterboxd failure count: <b>{len(letterboxd_failures)}</b></p>
    <p>Missing cinemas count: <b>{len(missing_cinemas)}</b></p>
    <p>Missing-cinema insert failure count: <b>{len(missing_cinema_insert_failures)}</b></p>
    <p>Total scrape streams recorded: <b>{len(scrape_run_details)}</b></p>
    <p>Cinema scraper streams recorded: <b>{len(cinema_scraper_details)}</b></p>
    <h3>TMDB Cache Breakdown</h3>
    <ul>{tmdb_cache_breakdown_items}</ul>
    <h3>Scrape Run Statuses</h3>
    <ul>{scrape_status_items}</ul>
    <h3>Cinema Scraper Statuses</h3>
    <ul>{cinema_scraper_status_items}</ul>
    <h3>Letterboxd Failure Breakdown</h3>
    <ul>{letterboxd_failure_breakdown_items}</ul>
    <h3>Letterboxd 403 Diagnostics</h3>
    <ul>
      <li>Observed HTTP 403 events: <b>{letterboxd_403_diagnostics.observed_403_events}</b></li>
      <li>Unique TMDB IDs impacted by 403: <b>{letterboxd_403_diagnostics.unique_tmdb_ids}</b></li>
      <li>Probable automated-block signals: <b>{letterboxd_403_diagnostics.probable_automated_block_events}</b></li>
      <li>Cooldown/block events: <b>{letterboxd_403_diagnostics.cooldown_events}</b></li>
      <li>Session refresh failures: <b>{letterboxd_403_diagnostics.session_refresh_errors}</b></li>
      <li>Session refresh non-200 responses: <b>{letterboxd_403_diagnostics.session_refresh_http_errors}</b></li>
      <li>Unique Cloudflare Ray IDs observed: <b>{letterboxd_403_diagnostics.unique_cf_rays}</b></li>
      <li>Interpretation: {escape(letterboxd_403_interpretation)}</li>
    </ul>
    <h3>Letterboxd CF-Ray Samples</h3>
    <ul>{letterboxd_403_cf_ray_items}</ul>
    <h3>Letterboxd Mitigation Settings</h3>
    <ul>
      <li>HTTP concurrency: <b>{LETTERBOXD_HTTP_CONCURRENCY}</b></li>
      <li>Minimum request interval: <b>{LETTERBOXD_MIN_REQUEST_INTERVAL_SECONDS:.2f}s</b></li>
      <li>HTTP 403 retry attempts: <b>{LETTERBOXD_HTTP_403_RETRY_ATTEMPTS}</b></li>
      <li>HTTP 403 streak threshold for cooldown: <b>{LETTERBOXD_HTTP_403_STREAK_BLOCK_THRESHOLD}</b></li>
      <li>Cooldown window after detected block: <b>{LETTERBOXD_CF_BLOCK_SECONDS:.0f}s</b></li>
      <li>Automatic session refresh-on-403: <b>enabled</b></li>
      <li>Persistent cookie jar across Letterboxd requests: <b>enabled</b></li>
    </ul>
    <h3>Sync Safety Guardrail</h3>
    <ul>
      <li>Deletion threshold: <b>{scrape_sync_service.MISSING_STREAK_TO_DEACTIVATE}</b> consecutive misses.</li>
      <li>Active source presences: <b>{presence_health.active_presence_count}</b></li>
      <li>Inactive source presences: <b>{presence_health.inactive_presence_count}</b></li>
      <li>Pending delete on next miss: <b>{presence_health.pending_delete_count}</b></li>
    </ul>
    <h3>Pending Delete By Stream</h3>
    <ul>{pending_delete_items}</ul>
    <h3>Slowest Streams</h3>
    <ul>{slowest_stream_items}</ul>
    <h3>TMDB Miss Titles (Top)</h3>
    <ul>{tmdb_miss_title_items}</ul>
    <h3>Low-Confidence TMDB Matches</h3>
    <ul>{low_confidence_items}</ul>
    <h3>Error Stages</h3>
    <ul>{error_stage_items}</ul>
    <h3>New Movies In Future Showtimes</h3>
    <ul>{new_movie_items}</ul>
    <h3>Per-Stream Run Details</h3>
    <ul>{run_detail_items}</ul>
    <h3>Per Cinema Scraper Detail</h3>
    <ul>{cinema_scraper_detail_items}</ul>
    <h3>Letterboxd Failure Events</h3>
    <ul>{letterboxd_failure_items}</ul>
    <h3>TMDB ID Not Found</h3>
    <ul>{tmdb_miss_items}</ul>
    <h3>Showtimes No Longer Found (Future Only)</h3>
    <ul>{deleted_items}</ul>
    <h3>Missing Cinemas</h3>
    <ul>{missing_cinema_items}</ul>
    <h3>Missing Cinema Insert Failures</h3>
    <ul>{missing_cinema_insert_failure_items}</ul>
    <h3>Errors</h3>
    <ul>{error_items}</ul>
    <p>Attachments include TMDB lookups, Letterboxd failures, Letterboxd 403 diagnostics, and full run details.</p>
    """


def _send_recap_email(
    *,
    started_at,
    finished_at,
    summary: ScrapeExecutionSummary,
    tmdb_lookups: list[dict],
    letterboxd_failures: list[dict[str, Any]],
    before_snapshot: FutureSnapshot,
    after_snapshot: FutureSnapshot,
) -> None:
    tmdb_misses = [lookup for lookup in tmdb_lookups if lookup["tmdb_id"] is None]

    deleted_showtimes = _dedupe_deleted_showtimes(summary.deleted_showtimes)
    deleted_showtimes = [
        showtime for showtime in deleted_showtimes if showtime.datetime >= finished_at
    ]

    errors = list(summary.errors)
    errors.extend(
        _load_scrape_run_errors(started_at=started_at, finished_at=finished_at)
    )
    # Deduplicate while preserving order.
    errors = list(dict.fromkeys(errors))
    missing_cinemas = sorted(set(summary.missing_cinemas))
    missing_cinema_insert_failures = list(
        dict.fromkeys(summary.missing_cinema_insert_failures)
    )
    tmdb_cache_counts = _tmdb_cache_breakdown(tmdb_lookups)
    tmdb_miss_titles = _tmdb_miss_title_counts(tmdb_misses)
    low_confidence_lookups = _tmdb_low_confidence_lookups(
        tmdb_lookups,
        threshold=TMDB_LOW_CONFIDENCE_THRESHOLD,
    )
    scrape_status_counts = _load_scrape_run_status_counts(
        started_at=started_at,
        finished_at=finished_at,
    )
    scrape_run_details = _load_scrape_run_details(
        started_at=started_at,
        finished_at=finished_at,
    )
    cinema_scraper_details = [
        detail
        for detail in scrape_run_details
        if detail.source_stream.startswith("cinema_scraper:")
    ]
    cinema_scraper_status_counts: dict[str, int] = {}
    for detail in cinema_scraper_details:
        cinema_scraper_status_counts[detail.status] = (
            cinema_scraper_status_counts.get(detail.status, 0) + 1
        )
    cinema_name_by_id = _load_cinema_name_by_id()
    letterboxd_failure_counts = _letterboxd_failure_breakdown(letterboxd_failures)
    letterboxd_403_diagnostics = _letterboxd_403_diagnostics(letterboxd_failures)
    slowest_run_details = sorted(
        [
            detail
            for detail in scrape_run_details
            if detail.duration_seconds is not None
        ],
        key=lambda detail: detail.duration_seconds or 0.0,
        reverse=True,
    )[:15]
    presence_health = _load_presence_health_snapshot()
    error_stage_counts = _error_stage_counts(errors)

    new_future_showtime_ids = after_snapshot.showtime_ids - before_snapshot.showtime_ids
    new_future_movie_ids = after_snapshot.movie_ids - before_snapshot.movie_ids
    new_future_movie_labels = _load_movie_labels(new_future_movie_ids)

    html = _render_recap_html(
        started_at=started_at,
        finished_at=finished_at,
        tmdb_lookups=tmdb_lookups,
        tmdb_misses=tmdb_misses,
        letterboxd_failures=letterboxd_failures,
        deleted_showtimes=deleted_showtimes,
        errors=errors,
        missing_cinemas=missing_cinemas,
        missing_cinema_insert_failures=missing_cinema_insert_failures,
        new_future_showtime_count=len(new_future_showtime_ids),
        new_future_movie_labels=new_future_movie_labels,
        future_showtime_count_before=len(before_snapshot.showtime_ids),
        future_showtime_count_after=len(after_snapshot.showtime_ids),
        future_movie_count_before=len(before_snapshot.movie_ids),
        future_movie_count_after=len(after_snapshot.movie_ids),
        tmdb_cache_counts=tmdb_cache_counts,
        scrape_status_counts=scrape_status_counts,
        scrape_run_details=scrape_run_details,
        cinema_scraper_details=cinema_scraper_details,
        cinema_scraper_status_counts=cinema_scraper_status_counts,
        cinema_name_by_id=cinema_name_by_id,
        slowest_run_details=slowest_run_details,
        presence_health=presence_health,
        tmdb_miss_titles=tmdb_miss_titles,
        low_confidence_lookups=low_confidence_lookups,
        low_confidence_threshold=TMDB_LOW_CONFIDENCE_THRESHOLD,
        error_stage_counts=error_stage_counts,
        letterboxd_failure_counts=letterboxd_failure_counts,
        letterboxd_403_diagnostics=letterboxd_403_diagnostics,
    )

    tmdb_low_confidence_compact = [
        _compact_tmdb_lookup_for_attachment(lookup)
        for lookup in low_confidence_lookups[:TMDB_RECAP_ATTACHMENT_MAX_ITEMS]
    ]
    tmdb_misses_compact = [
        _compact_tmdb_lookup_for_attachment(lookup)
        for lookup in tmdb_misses[:TMDB_RECAP_ATTACHMENT_MAX_ITEMS]
    ]
    tmdb_lookup_attachment_data = _compact_json_bytes(
        {
            "meta": {
                "total_lookups": len(tmdb_lookups),
                "cache_breakdown": tmdb_cache_counts,
                "miss_count": len(tmdb_misses),
                "low_confidence_threshold": TMDB_LOW_CONFIDENCE_THRESHOLD,
                "low_confidence_count": len(low_confidence_lookups),
                "max_items_per_section": TMDB_RECAP_ATTACHMENT_MAX_ITEMS,
            },
            "low_confidence": tmdb_low_confidence_compact,
            "misses": tmdb_misses_compact,
        }
    )
    tmdb_lookup_attachment_name = f"tmdb_lookups_{started_at:%Y%m%d_%H%M%S}.json"

    scrape_runs_attachment_data = _compact_json_bytes(
        [
            {
                "source_stream": detail.source_stream,
                "source_stream_display": _stream_display_name(
                    detail.source_stream,
                    cinema_name_by_id,
                ),
                "status": detail.status,
                "started_at": detail.started_at.isoformat(),
                "finished_at": (
                    detail.finished_at.isoformat()
                    if detail.finished_at is not None
                    else None
                ),
                "duration_seconds": detail.duration_seconds,
                "observed_showtime_count": detail.observed_showtime_count,
                "error": detail.error,
            }
            for detail in scrape_run_details
        ]
    )
    scrape_runs_attachment_name = f"scrape_runs_{started_at:%Y%m%d_%H%M%S}.json"
    cinema_scraper_runs_attachment_data = _compact_json_bytes(
        [
            {
                "source_stream": detail.source_stream,
                "source_stream_display": _stream_display_name(
                    detail.source_stream,
                    cinema_name_by_id,
                ),
                "status": detail.status,
                "started_at": detail.started_at.isoformat(),
                "finished_at": (
                    detail.finished_at.isoformat()
                    if detail.finished_at is not None
                    else None
                ),
                "duration_seconds": detail.duration_seconds,
                "observed_showtime_count": detail.observed_showtime_count,
                "error": detail.error,
            }
            for detail in cinema_scraper_details
        ]
    )
    cinema_scraper_runs_attachment_name = (
        f"cinema_scraper_runs_{started_at:%Y%m%d_%H%M%S}.json"
    )

    letterboxd_failures_attachment_data = _compact_json_bytes(
        letterboxd_failures,
    )
    letterboxd_failures_attachment_name = (
        f"letterboxd_failures_{started_at:%Y%m%d_%H%M%S}.json"
    )
    letterboxd_403_diagnostics_attachment_data = _compact_json_bytes(
        {
            "observed_403_events": letterboxd_403_diagnostics.observed_403_events,
            "unique_tmdb_ids": letterboxd_403_diagnostics.unique_tmdb_ids,
            "probable_automated_block_events": (
                letterboxd_403_diagnostics.probable_automated_block_events
            ),
            "cooldown_events": letterboxd_403_diagnostics.cooldown_events,
            "session_refresh_errors": (
                letterboxd_403_diagnostics.session_refresh_errors
            ),
            "session_refresh_http_errors": (
                letterboxd_403_diagnostics.session_refresh_http_errors
            ),
            "unique_cf_rays": letterboxd_403_diagnostics.unique_cf_rays,
            "sample_cf_rays": letterboxd_403_diagnostics.sample_cf_rays,
            "mitigation_settings": {
                "http_concurrency": LETTERBOXD_HTTP_CONCURRENCY,
                "min_request_interval_seconds": (
                    LETTERBOXD_MIN_REQUEST_INTERVAL_SECONDS
                ),
                "http_403_retry_attempts": LETTERBOXD_HTTP_403_RETRY_ATTEMPTS,
                "http_403_streak_block_threshold": (
                    LETTERBOXD_HTTP_403_STREAK_BLOCK_THRESHOLD
                ),
                "cooldown_seconds": LETTERBOXD_CF_BLOCK_SECONDS,
                "session_refresh_on_403": True,
                "persistent_cookie_jar": True,
            },
        }
    )
    letterboxd_403_diagnostics_attachment_name = (
        f"letterboxd_403_diagnostics_{started_at:%Y%m%d_%H%M%S}.json"
    )

    presence_health_attachment_data = _compact_json_bytes(
        {
            "missing_streak_to_deactivate": (
                scrape_sync_service.MISSING_STREAK_TO_DEACTIVATE
            ),
            "active_presence_count": presence_health.active_presence_count,
            "inactive_presence_count": presence_health.inactive_presence_count,
            "pending_delete_count": presence_health.pending_delete_count,
            "pending_delete_by_stream": [
                {"source_stream": source_stream, "count": count}
                for source_stream, count in presence_health.pending_delete_by_stream
            ],
        }
    )
    presence_health_attachment_name = f"presence_health_{started_at:%Y%m%d_%H%M%S}.json"
    missing_cinema_insert_failures_attachment_data = _compact_json_bytes(
        missing_cinema_insert_failures,
    )
    missing_cinema_insert_failures_attachment_name = (
        f"missing_cinema_insert_failures_{started_at:%Y%m%d_%H%M%S}.json"
    )

    send_email(
        email_to=RECAP_EMAIL_TO,
        subject=(
            "Cinema Scrape Recap "
            f"{started_at:%Y-%m-%d %H:%M} -> {finished_at:%Y-%m-%d %H:%M}"
        ),
        html_content=html,
        attachments=[
            {
                "filename": tmdb_lookup_attachment_name,
                "data": tmdb_lookup_attachment_data,
                "mime_type": "application/json",
            },
            {
                "filename": scrape_runs_attachment_name,
                "data": scrape_runs_attachment_data,
                "mime_type": "application/json",
            },
            {
                "filename": cinema_scraper_runs_attachment_name,
                "data": cinema_scraper_runs_attachment_data,
                "mime_type": "application/json",
            },
            {
                "filename": letterboxd_failures_attachment_name,
                "data": letterboxd_failures_attachment_data,
                "mime_type": "application/json",
            },
            {
                "filename": letterboxd_403_diagnostics_attachment_name,
                "data": letterboxd_403_diagnostics_attachment_data,
                "mime_type": "application/json",
            },
            {
                "filename": presence_health_attachment_name,
                "data": presence_health_attachment_data,
                "mime_type": "application/json",
            },
            {
                "filename": missing_cinema_insert_failures_attachment_name,
                "data": missing_cinema_insert_failures_attachment_data,
                "mime_type": "application/json",
            },
        ],
    )


def _send_recap_email_with_timeout(
    *,
    started_at: datetime,
    finished_at: datetime,
    summary: ScrapeExecutionSummary,
    tmdb_lookups: list[dict[str, Any]],
    letterboxd_failures: list[dict[str, Any]],
    before_snapshot: FutureSnapshot,
    after_snapshot: FutureSnapshot,
) -> None:
    timeout_seconds = max(1.0, float(settings.SCRAPE_RECAP_EMAIL_TIMEOUT_SECONDS))
    done = threading.Event()
    error_holder: dict[str, Exception] = {}

    def _worker() -> None:
        try:
            _send_recap_email(
                started_at=started_at,
                finished_at=finished_at,
                summary=summary,
                tmdb_lookups=tmdb_lookups,
                letterboxd_failures=letterboxd_failures,
                before_snapshot=before_snapshot,
                after_snapshot=after_snapshot,
            )
        except Exception as exc:  # pragma: no cover - reported via error_holder
            error_holder["error"] = exc
        finally:
            done.set()

    thread = threading.Thread(target=_worker, name="scrape-recap-email", daemon=True)
    thread.start()
    if not done.wait(timeout_seconds):
        logger.error(
            "Timed out sending scrape recap email after %.1fs; continuing shutdown.",
            timeout_seconds,
        )
        return
    if "error" in error_holder:
        raise error_holder["error"]


def run() -> None:
    started_at = now_amsterdam_naive()
    reset_tmdb_runtime_state()
    reset_letterboxd_request_budget()
    before_snapshot = _load_future_snapshot(snapshot_time=started_at)
    summary = ScrapeExecutionSummary()
    tmdb_lookups: list[dict] = []
    letterboxd_failures: list[dict[str, Any]] = []
    fatal_error: Exception | None = None
    interrupted = False
    try:
        logger.info("Starting cineville scraper...")
        cineville_summary = scrape_cineville()
        _combine_summaries(current=summary, new=cineville_summary)
        logger.info("Cineville scraper finished successfully.")
        logger.info("Starting cinema scrapers...")
        cinema_summary = run_cinema_scrapers()
        _combine_summaries(current=summary, new=cinema_summary)
        logger.info("Ran all cinema scrapers.")
        logger.info("Starting Cineville conflict cleanup...")
        try:
            with get_db_context() as session:
                conflict_deleted = _delete_cineville_title_conflicts(session=session)
            summary.deleted_showtimes.extend(conflict_deleted)
            logger.info(
                "Cineville conflict cleanup finished. Deleted %s showtime(s).",
                len(conflict_deleted),
            )
        except Exception as cleanup_error:
            summary.errors.append(
                "stage=cineville_conflict_cleanup | "
                f"error_type={type(cleanup_error).__name__} | "
                f"error={cleanup_error}"
            )
            logger.error("Failed during Cineville conflict cleanup", exc_info=True)
        logger.info("Starting Letterboxd slug/poster backfill...")
        letterboxd_backfill_summary = backfill_missing_letterboxd_data()
        logger.info(
            "Letterboxd backfill done (candidates=%s updated=%s skipped=%s failed=%s).",
            letterboxd_backfill_summary.candidates,
            letterboxd_backfill_summary.updated,
            letterboxd_backfill_summary.skipped,
            letterboxd_backfill_summary.failed,
        )
    except Exception as e:
        fatal_error = e
        summary.errors.append(str(e))
        logger.error("Error running cinema scraper", exc_info=True)
    except KeyboardInterrupt:
        interrupted = True
        logger.warning("KeyboardInterrupt received; skipping recap email and exiting.")
    finally:
        if not interrupted:
            finished_at = now_amsterdam_naive()
            after_snapshot = _load_future_snapshot(snapshot_time=started_at)
            tmdb_lookups = consume_tmdb_lookup_events()
            letterboxd_failures = consume_letterboxd_failure_events()
            try:
                written_paths = _write_tmdb_resolution_audit_files(
                    started_at=started_at,
                    tmdb_lookups=tmdb_lookups,
                )
                logger.info(
                    "Wrote TMDB resolution audit files: %s",
                    ", ".join(str(path) for path in written_paths),
                )
                generated_json_path = next(
                    (path for path in written_paths if path.suffix.lower() == ".json"),
                    None,
                )
                if generated_json_path is not None:
                    fixture_path = _tmdb_fixture_source_of_truth_path()
                    existing_count, generated_count, merged_count = (
                        _merge_generated_tmdb_fixture_into_source_of_truth(
                            generated_json_path=generated_json_path,
                            source_of_truth_path=fixture_path,
                        )
                    )
                    logger.info(
                        "Merged TMDB fixture cases into %s (existing=%s, generated=%s, merged=%s).",
                        fixture_path,
                        existing_count,
                        generated_count,
                        merged_count,
                    )
                deleted_paths = _cleanup_tmdb_resolution_audit_files()
                if deleted_paths:
                    logger.info(
                        "Deleted TMDB resolution audit artifacts: %s",
                        ", ".join(str(path) for path in deleted_paths),
                    )
            except Exception:
                logger.error(
                    "Failed to write/merge/cleanup TMDB resolution audit files.",
                    exc_info=True,
                )
            try:
                _send_recap_email_with_timeout(
                    started_at=started_at,
                    finished_at=finished_at,
                    summary=summary,
                    tmdb_lookups=tmdb_lookups,
                    letterboxd_failures=letterboxd_failures,
                    before_snapshot=before_snapshot,
                    after_snapshot=after_snapshot,
                )
                logger.info("Sent scrape recap email.")
            except Exception:
                logger.error("Failed to send scrape recap email.", exc_info=True)

    if fatal_error is not None:
        sys.exit(1)


if __name__ == "__main__":
    run()
