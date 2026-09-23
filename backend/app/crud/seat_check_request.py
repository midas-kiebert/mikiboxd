"""Reads and writes of the hand-requested seat reading log."""

from datetime import datetime

from sqlalchemy import delete, func, text
from sqlmodel import Session, col, select

from app.models.seat_check_request import SeatCheckRequest

# Any fixed number works as long as nothing else takes a transaction-level
# advisory lock on it; it only has to be the same in every worker.
_BUDGET_LOCK_KEY = 0x5EA7_C4EC


def lock_budget(*, session: Session) -> None:
    """Serialise budget decisions across every worker until this transaction ends.

    Counting and then inserting is a race without it: two workers can both see
    one slot left and both take it. Held for one count and one insert, so the
    wait is never noticeable.
    """
    session.execute(
        text("SELECT pg_advisory_xact_lock(:key)"), {"key": _BUDGET_LOCK_KEY}
    )


def count_since(*, session: Session, since: datetime) -> int:
    stmt = select(func.count()).where(col(SeatCheckRequest.requested_at) > since)
    return session.exec(stmt).one()


def count_by_host_since(
    *, session: Session, since: datetime, hosts: list[str]
) -> dict[str, int]:
    if not hosts:
        return {}
    stmt = (
        select(col(SeatCheckRequest.host), func.count())
        .where(
            col(SeatCheckRequest.requested_at) > since,
            col(SeatCheckRequest.host).in_(hosts),
        )
        .group_by(col(SeatCheckRequest.host))
    )
    return dict(session.exec(stmt).all())


def get_requested_since(
    *, session: Session, since: datetime, showtime_ids: list[int]
) -> set[int]:
    """Which of `showtime_ids` have been asked about by hand after `since`."""
    if not showtime_ids:
        return set()
    stmt = select(col(SeatCheckRequest.showtime_id)).where(
        col(SeatCheckRequest.requested_at) > since,
        col(SeatCheckRequest.showtime_id).in_(showtime_ids),
    )
    return set(session.exec(stmt).all())


def create(
    *, session: Session, showtime_id: int, host: str, requested_at: datetime
) -> SeatCheckRequest:
    request = SeatCheckRequest(
        showtime_id=showtime_id, host=host, requested_at=requested_at
    )
    session.add(request)
    session.flush()
    return request


def delete_by_id(*, session: Session, request_id: int) -> None:
    session.execute(delete(SeatCheckRequest).where(col(SeatCheckRequest.id) == request_id))


def delete_older_than(*, session: Session, before: datetime) -> None:
    session.execute(
        delete(SeatCheckRequest).where(col(SeatCheckRequest.requested_at) <= before)
    )
