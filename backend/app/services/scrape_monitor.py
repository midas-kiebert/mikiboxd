"""Read-only aggregation for the admin scrape monitor.

Turns the raw ``ScrapeRun`` / ``ScrapeRecap`` audit rows into a per-stream view
with deltas and anomaly flags, using the same thresholds the scraper itself uses
to decide a run is suspicious (so the dashboard agrees with the deletion guard).
"""

import base64
import json
from datetime import timedelta

from sqlmodel import Session, col, select

from app.models.cinema import Cinema
from app.models.scrape_recap import ScrapeRecap
from app.models.scrape_run import ScrapeRun, ScrapeRunStatus
from app.schemas.scrape_monitor import (
    ScrapeMonitorResponse,
    ScrapeMonitorSummary,
    ScrapeRecapAttachment,
    ScrapeRecapDetail,
    ScrapeRecapView,
    ScrapeRunView,
)
from app.services.scrape_sync import (
    MIN_BASELINE_FOR_RATIO_GUARD,
    MIN_OBSERVED_RATIO,
)
from app.utils import now_amsterdam_naive


def _cinema_name_by_id(*, session: Session) -> dict[int, str]:
    rows = session.exec(select(Cinema.id, Cinema.name)).all()
    return {int(cinema_id): str(name) for cinema_id, name in rows}


def _stream_label(source_stream: str, cinema_name_by_id: dict[int, str]) -> str:
    """Human label for a source_stream, e.g. 'cineville:17' -> 'Cineville — LAB111'."""
    prefix, _, suffix = source_stream.partition(":")
    kind = {"cineville": "Cineville", "cinema_scraper": "Scraper"}.get(prefix, prefix)
    if suffix.isdigit():
        cinema_name = cinema_name_by_id.get(int(suffix))
        if cinema_name is not None:
            return f"{kind} — {cinema_name}"
    return source_stream


def get_scrape_runs(*, session: Session, window_hours: int) -> ScrapeMonitorResponse:
    generated_at = now_amsterdam_naive()
    window_hours = max(1, min(window_hours, 24 * 30))

    window_start = generated_at - timedelta(hours=window_hours)

    # Pull a little history before the window too, so the first in-window run of
    # each stream still has a "previous successful count" to compare against.
    lookback_start = window_start - timedelta(days=7)
    rows = list(
        session.exec(
            select(ScrapeRun)
            .where(ScrapeRun.started_at >= lookback_start)
            .order_by(col(ScrapeRun.started_at).asc())
        ).all()
    )

    cinema_name_by_id = _cinema_name_by_id(session=session)
    last_success_count: dict[str, int] = {}
    views: list[ScrapeRunView] = []
    for run in rows:
        previous = last_success_count.get(run.source_stream)
        observed = run.observed_showtime_count
        delta = (
            observed - previous
            if observed is not None and previous is not None
            else None
        )
        duration = (
            (run.finished_at - run.started_at).total_seconds()
            if run.finished_at is not None
            else None
        )
        is_failed = run.status == ScrapeRunStatus.FAILED
        is_degraded = run.status == ScrapeRunStatus.DEGRADED
        is_zero = bool(observed == 0 and previous is not None and previous > 0)
        is_big_drop = bool(
            previous is not None
            and previous >= MIN_BASELINE_FOR_RATIO_GUARD
            and observed is not None
            and observed < previous * MIN_OBSERVED_RATIO
        )

        if run.started_at >= window_start:
            views.append(
                ScrapeRunView(
                    id=run.id if run.id is not None else 0,
                    source_stream=run.source_stream,
                    source_label=_stream_label(run.source_stream, cinema_name_by_id),
                    status=run.status.value,
                    started_at=run.started_at,
                    finished_at=run.finished_at,
                    duration_seconds=duration,
                    observed_showtime_count=observed,
                    previous_observed_count=previous,
                    delta=delta,
                    error=run.error,
                    is_failed=is_failed,
                    is_degraded=is_degraded,
                    is_zero_observed=is_zero,
                    is_big_drop=is_big_drop,
                )
            )

        if run.status == ScrapeRunStatus.SUCCESS and observed is not None:
            last_success_count[run.source_stream] = observed

    views.sort(key=lambda view: view.started_at, reverse=True)

    anomaly_streams = sorted({view.source_stream for view in views if view.is_anomaly})
    summary = ScrapeMonitorSummary(
        window_hours=window_hours,
        generated_at=generated_at,
        total_runs=len(views),
        failed_runs=sum(1 for view in views if view.is_failed),
        degraded_runs=sum(1 for view in views if view.is_degraded),
        anomaly_runs=sum(1 for view in views if view.is_anomaly),
        streams_with_anomalies=anomaly_streams,
    )
    return ScrapeMonitorResponse(summary=summary, runs=views)


def list_recaps(*, session: Session, limit: int) -> list[ScrapeRecapView]:
    limit = max(1, min(limit, 200))
    rows = session.exec(
        select(ScrapeRecap).order_by(col(ScrapeRecap.started_at).desc()).limit(limit)
    ).all()
    return [
        ScrapeRecapView(
            id=recap.id if recap.id is not None else 0,
            started_at=recap.started_at,
            finished_at=recap.finished_at,
            subject=recap.subject,
            created_at=recap.created_at,
        )
        for recap in rows
    ]


def get_recap(*, session: Session, recap_id: int) -> ScrapeRecapDetail | None:
    recap = session.get(ScrapeRecap, recap_id)
    if recap is None:
        return None
    attachments: list[ScrapeRecapAttachment] = []
    try:
        for attachment in json.loads(recap.attachments_json):
            data_b64 = attachment.get("data_b64", "")
            attachments.append(
                ScrapeRecapAttachment(
                    filename=str(attachment.get("filename", "attachment")),
                    mime_type=str(attachment.get("mime_type", "application/json")),
                    size_bytes=len(base64.b64decode(data_b64)) if data_b64 else 0,
                )
            )
    except (ValueError, KeyError):
        attachments = []
    return ScrapeRecapDetail(
        id=recap.id if recap.id is not None else 0,
        started_at=recap.started_at,
        finished_at=recap.finished_at,
        subject=recap.subject,
        created_at=recap.created_at,
        html=recap.html,
        attachments=attachments,
    )


def get_recap_attachment(
    *, session: Session, recap_id: int, filename: str
) -> tuple[bytes, str] | None:
    """Return (raw_bytes, mime_type) for one recap attachment, or None."""
    recap = session.get(ScrapeRecap, recap_id)
    if recap is None:
        return None
    try:
        for attachment in json.loads(recap.attachments_json):
            if attachment.get("filename") == filename:
                data = base64.b64decode(attachment.get("data_b64", ""))
                mime_type = str(attachment.get("mime_type", "application/json"))
                return data, mime_type
    except (ValueError, KeyError):
        return None
    return None
