import json
import re
import sys
from dataclasses import dataclass
from datetime import datetime
from html import escape
from typing import Any

from sqlalchemy import func
from sqlmodel import col, select

from app.api.deps import get_db_context
from app.models.cinema import Cinema
from app.models.movie import Movie
from app.models.scrape_run import ScrapeRun, ScrapeRunStatus
from app.models.showtime import Showtime
from app.models.showtime_source_presence import ShowtimeSourcePresence
from app.scraping.letterboxd.load_letterboxd_data import (
    consume_letterboxd_failure_events,
)
from app.scraping.logger import logger
from app.scraping.scrape import (
    ScrapeExecutionSummary,
    run_cinema_scrapers,
    scrape_cineville,
)
from app.scraping.tmdb import consume_tmdb_lookup_events
from app.services import scrape_sync as scrape_sync_service
from app.services.scrape_sync import DeletedShowtimeInfo
from app.utils import now_amsterdam_naive, send_email

RECAP_EMAIL_TO = "scraper.mikino@midaskiebert.nl"
STAGE_PATTERN = re.compile(r"(^|\s)stage=([^|]+)")


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
    error_stage_counts: dict[str, int],
    letterboxd_failure_counts: dict[str, int],
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
        "".join(
            f"<li><code>{escape(json.dumps(item['payload'], ensure_ascii=False, sort_keys=True))}</code></li>"
            for item in tmdb_misses
        )
        or "<li>None</li>"
    )
    tmdb_miss_title_items = (
        "".join(
            f"<li>{escape(title)}: <b>{count}</b></li>"
            for title, count in tmdb_miss_titles[:25]
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
            "<li>"
            + escape(
                " | ".join(
                    str(part)
                    for part in [
                        failure.get("timestamp", "unknown_time"),
                        f"event={failure.get('event_type', 'unknown_failure')}",
                        (
                            f"tmdb_id={failure.get('tmdb_id')}"
                            if failure.get("tmdb_id") is not None
                            else None
                        ),
                        (
                            f"status={failure.get('status_code')}"
                            if failure.get("status_code") is not None
                            else None
                        ),
                        (
                            f"reason={failure.get('reason')}"
                            if failure.get("reason") is not None
                            else None
                        ),
                        (
                            f"url={failure.get('url')}"
                            if failure.get("url") is not None
                            else None
                        ),
                    ]
                    if part is not None
                )
            )
            + "</li>"
            for failure in letterboxd_failures
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
    <p>Attachments include TMDB lookups, Letterboxd failures, and full run details.</p>
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
        error_stage_counts=error_stage_counts,
        letterboxd_failure_counts=letterboxd_failure_counts,
    )

    tmdb_lookup_attachment_data = json.dumps(
        tmdb_lookups,
        ensure_ascii=False,
        indent=2,
        sort_keys=True,
    ).encode("utf-8")
    tmdb_lookup_attachment_name = f"tmdb_lookups_{started_at:%Y%m%d_%H%M%S}.json"

    scrape_runs_attachment_data = json.dumps(
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
        ],
        ensure_ascii=False,
        indent=2,
        sort_keys=True,
    ).encode("utf-8")
    scrape_runs_attachment_name = f"scrape_runs_{started_at:%Y%m%d_%H%M%S}.json"
    cinema_scraper_runs_attachment_data = json.dumps(
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
        ],
        ensure_ascii=False,
        indent=2,
        sort_keys=True,
    ).encode("utf-8")
    cinema_scraper_runs_attachment_name = (
        f"cinema_scraper_runs_{started_at:%Y%m%d_%H%M%S}.json"
    )

    letterboxd_failures_attachment_data = json.dumps(
        letterboxd_failures,
        ensure_ascii=False,
        indent=2,
        sort_keys=True,
    ).encode("utf-8")
    letterboxd_failures_attachment_name = (
        f"letterboxd_failures_{started_at:%Y%m%d_%H%M%S}.json"
    )

    presence_health_attachment_data = json.dumps(
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
        },
        ensure_ascii=False,
        indent=2,
        sort_keys=True,
    ).encode("utf-8")
    presence_health_attachment_name = f"presence_health_{started_at:%Y%m%d_%H%M%S}.json"
    missing_cinema_insert_failures_attachment_data = json.dumps(
        missing_cinema_insert_failures,
        ensure_ascii=False,
        indent=2,
        sort_keys=True,
    ).encode("utf-8")
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


def run() -> None:
    started_at = now_amsterdam_naive()
    before_snapshot = _load_future_snapshot(snapshot_time=started_at)
    summary = ScrapeExecutionSummary()
    tmdb_lookups: list[dict] = []
    letterboxd_failures: list[dict[str, Any]] = []
    fatal_error: Exception | None = None
    try:
        logger.info("Starting cineville scraper...")
        cineville_summary = scrape_cineville()
        _combine_summaries(current=summary, new=cineville_summary)
        logger.info("Cineville scraper finished successfully.")
        logger.info("Starting cinema scrapers...")
        cinema_summary = run_cinema_scrapers()
        _combine_summaries(current=summary, new=cinema_summary)
        logger.info("Ran all cinema scrapers.")
    except Exception as e:
        fatal_error = e
        summary.errors.append(str(e))
        logger.error("Error running cinema scraper", exc_info=True)
    finally:
        finished_at = now_amsterdam_naive()
        after_snapshot = _load_future_snapshot(snapshot_time=started_at)
        tmdb_lookups = consume_tmdb_lookup_events()
        letterboxd_failures = consume_letterboxd_failure_events()
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
            logger.info("Sent scrape recap email.")
        except Exception:
            logger.error("Failed to send scrape recap email.", exc_info=True)

    if fatal_error is not None:
        sys.exit(1)


if __name__ == "__main__":
    run()
