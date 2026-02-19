from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import exists
from sqlmodel import Session, col, delete, select

from app.models.scrape_run import ScrapeRun, ScrapeRunStatus
from app.models.showtime import Showtime
from app.models.showtime_source_presence import ShowtimeSourcePresence
from app.utils import now_amsterdam_naive

MISSING_STREAK_TO_DEACTIVATE = 2
MIN_BASELINE_FOR_RATIO_GUARD = 10
MIN_OBSERVED_RATIO = 0.30
ORPHAN_DELETE_CUTOFF_DAYS = 1


@dataclass(frozen=True)
class ObservedPresence:
    source_event_key: str
    showtime_id: int


@dataclass(frozen=True)
class DeletedShowtimeInfo:
    showtime_id: int
    movie_id: int
    movie_title: str
    cinema_id: int
    cinema_name: str
    datetime: datetime
    ticket_link: str | None


def fallback_source_event_key(
    *,
    movie_id: int,
    cinema_id: int,
    dt,
    ticket_link: str | None,
) -> str:
    ticket = ticket_link or ""
    return f"{movie_id}|{cinema_id}|{dt.isoformat()}|{ticket}"


def record_failed_run(
    *,
    session: Session,
    source_stream: str,
    error: str,
    started_at=None,
) -> None:
    started = started_at or now_amsterdam_naive()
    finished = now_amsterdam_naive()
    run = ScrapeRun(
        source_stream=source_stream,
        status=ScrapeRunStatus.FAILED,
        started_at=started,
        finished_at=finished,
        observed_showtime_count=0,
        error=error[:1000],
    )
    session.add(run)
    session.commit()


def _latest_success_observed_count(
    *,
    session: Session,
    source_stream: str,
    exclude_run_id: int,
) -> int | None:
    stmt = (
        select(ScrapeRun)
        .where(
            ScrapeRun.source_stream == source_stream,
            ScrapeRun.status == ScrapeRunStatus.SUCCESS,
            ScrapeRun.id != exclude_run_id,
            col(ScrapeRun.observed_showtime_count).is_not(None),
        )
        .order_by(col(ScrapeRun.started_at).desc())
        .limit(1)
    )
    run = session.exec(stmt).first()
    if run is None:
        return None
    return run.observed_showtime_count


def _latest_run(
    *,
    session: Session,
    source_stream: str,
    exclude_run_id: int,
) -> ScrapeRun | None:
    stmt = (
        select(ScrapeRun)
        .where(
            ScrapeRun.source_stream == source_stream,
            ScrapeRun.id != exclude_run_id,
        )
        .order_by(col(ScrapeRun.started_at).desc())
        .limit(1)
    )
    return session.exec(stmt).first()


def _upsert_observed_presence(
    *,
    session: Session,
    source_stream: str,
    observed: ObservedPresence,
    run_id: int,
    seen_at,
) -> int | None:
    stmt = select(ShowtimeSourcePresence).where(
        ShowtimeSourcePresence.source_stream == source_stream,
        ShowtimeSourcePresence.source_event_key == observed.source_event_key,
    )
    existing = session.exec(stmt).first()
    if existing is None:
        session.add(
            ShowtimeSourcePresence(
                source_stream=source_stream,
                source_event_key=observed.source_event_key,
                showtime_id=observed.showtime_id,
                last_seen_run_id=run_id,
                last_seen_at=seen_at,
                missing_streak=0,
                active=True,
            )
        )
        return None

    previous_showtime_id = existing.showtime_id
    existing.showtime_id = observed.showtime_id
    existing.last_seen_run_id = run_id
    existing.last_seen_at = seen_at
    existing.missing_streak = 0
    existing.active = True
    if previous_showtime_id != observed.showtime_id:
        return previous_showtime_id
    return None


def _mark_missing_for_unseen(
    *,
    session: Session,
    source_stream: str,
    seen_keys: set[str],
) -> None:
    stmt = select(ShowtimeSourcePresence).where(
        ShowtimeSourcePresence.source_stream == source_stream,
        col(ShowtimeSourcePresence.active).is_(True),
    )
    presences = list(session.exec(stmt).all())
    for presence in presences:
        if presence.source_event_key in seen_keys:
            continue
        presence.missing_streak += 1
        if presence.missing_streak >= MISSING_STREAK_TO_DEACTIVATE:
            presence.active = False


def _seed_pending_missing_after_remap(
    *,
    session: Session,
    source_stream: str,
    remapped_showtime_ids: set[int],
    run_id: int,
    seen_at: datetime,
) -> None:
    if not remapped_showtime_ids:
        return
    for showtime_id in remapped_showtime_ids:
        synthetic_key = f"__remap_old__:{showtime_id}"
        stmt = select(ShowtimeSourcePresence).where(
            ShowtimeSourcePresence.source_stream == source_stream,
            ShowtimeSourcePresence.source_event_key == synthetic_key,
        )
        existing = session.exec(stmt).first()
        if existing is None:
            session.add(
                ShowtimeSourcePresence(
                    source_stream=source_stream,
                    source_event_key=synthetic_key,
                    showtime_id=showtime_id,
                    last_seen_run_id=run_id,
                    last_seen_at=seen_at,
                    # Start at one miss so it deactivates only after the next miss.
                    missing_streak=1,
                    active=True,
                )
            )
            continue
        existing.showtime_id = showtime_id
        existing.last_seen_run_id = run_id
        existing.last_seen_at = seen_at
        existing.missing_streak = 1
        existing.active = True


def _delete_orphaned_managed_showtimes(
    *,
    session: Session,
) -> list[DeletedShowtimeInfo]:
    cutoff = now_amsterdam_naive() - timedelta(days=ORPHAN_DELETE_CUTOFF_DAYS)

    any_presence_exists = exists(
        select(ShowtimeSourcePresence.id).where(
            ShowtimeSourcePresence.showtime_id == Showtime.id
        )
    )
    active_presence_exists = exists(
        select(ShowtimeSourcePresence.id).where(
            ShowtimeSourcePresence.showtime_id == Showtime.id,
            col(ShowtimeSourcePresence.active).is_(True),
        )
    )

    stmt_ids = select(Showtime.id).where(
        any_presence_exists,
        ~active_presence_exists,
        Showtime.datetime >= cutoff,
    )
    showtime_ids = set(session.exec(stmt_ids).all())

    showtime_ids_list = list(showtime_ids)
    if not showtime_ids_list:
        return []

    stmt_showtimes = select(Showtime).where(col(Showtime.id).in_(showtime_ids_list))
    showtimes = list(session.exec(stmt_showtimes).all())
    deleted_showtimes = [
        DeletedShowtimeInfo(
            showtime_id=showtime.id,
            movie_id=showtime.movie_id,
            movie_title=showtime.movie.title,
            cinema_id=showtime.cinema_id,
            cinema_name=showtime.cinema.name,
            datetime=showtime.datetime,
            ticket_link=showtime.ticket_link,
        )
        for showtime in showtimes
    ]

    stmt_delete = delete(Showtime).where(col(Showtime.id).in_(showtime_ids_list))
    session.execute(stmt_delete)
    return deleted_showtimes


def record_success_run(
    *,
    session: Session,
    source_stream: str,
    observed_presences: list[ObservedPresence],
    started_at=None,
) -> tuple[ScrapeRunStatus, list[DeletedShowtimeInfo]]:
    started = started_at or now_amsterdam_naive()
    finished = now_amsterdam_naive()

    # Deduplicate by event key; last write wins.
    deduped: dict[str, int] = {}
    for presence in observed_presences:
        deduped[presence.source_event_key] = presence.showtime_id
    seen_keys = set(deduped.keys())
    observed_count = len(seen_keys)

    run = ScrapeRun(
        source_stream=source_stream,
        status=ScrapeRunStatus.SUCCESS,
        started_at=started,
        finished_at=finished,
        observed_showtime_count=observed_count,
        error=None,
    )
    session.add(run)
    session.flush()
    assert run.id is not None
    run_id = run.id

    previous_success_count = _latest_success_observed_count(
        session=session,
        source_stream=source_stream,
        exclude_run_id=run_id,
    )
    previous_run = _latest_run(
        session=session,
        source_stream=source_stream,
        exclude_run_id=run_id,
    )

    degraded_reason: str | None = None
    suspicious_reason: str | None = None
    if previous_success_count is not None and previous_success_count > 0:
        if observed_count == 0:
            suspicious_reason = (
                f"Observed 0 showtimes but previous successful run had "
                f"{previous_success_count}."
            )
        elif (
            previous_success_count >= MIN_BASELINE_FOR_RATIO_GUARD
            and observed_count < previous_success_count * MIN_OBSERVED_RATIO
        ):
            suspicious_reason = (
                f"Observed {observed_count} showtimes, below safety ratio "
                f"({MIN_OBSERVED_RATIO:.0%}) of previous successful run "
                f"({previous_success_count})."
            )
    if suspicious_reason is not None:
        same_suspicious_as_previous = (
            previous_run is not None
            and previous_run.status == ScrapeRunStatus.DEGRADED
            and previous_run.observed_showtime_count == observed_count
        )
        if not same_suspicious_as_previous:
            degraded_reason = suspicious_reason

    remapped_showtime_ids: set[int] = set()
    for source_event_key, showtime_id in deduped.items():
        remapped_old_id = _upsert_observed_presence(
            session=session,
            source_stream=source_stream,
            observed=ObservedPresence(
                source_event_key=source_event_key,
                showtime_id=showtime_id,
            ),
            run_id=run_id,
            seen_at=finished,
        )
        if remapped_old_id is not None:
            remapped_showtime_ids.add(remapped_old_id)

    deleted_showtimes: list[DeletedShowtimeInfo] = []
    if degraded_reason is None:
        _mark_missing_for_unseen(
            session=session,
            source_stream=source_stream,
            seen_keys=seen_keys,
        )
        _seed_pending_missing_after_remap(
            session=session,
            source_stream=source_stream,
            remapped_showtime_ids=remapped_showtime_ids,
            run_id=run_id,
            seen_at=finished,
        )
        deleted_showtimes = _delete_orphaned_managed_showtimes(
            session=session,
        )
        run.status = ScrapeRunStatus.SUCCESS
        run.error = None
    else:
        run.status = ScrapeRunStatus.DEGRADED
        run.error = degraded_reason

    run.finished_at = finished
    run.observed_showtime_count = observed_count
    session.add(run)
    session.commit()
    return run.status, deleted_showtimes
