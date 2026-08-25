"""Sold-out watch reads and writes."""

from datetime import datetime
from uuid import UUID

from sqlmodel import Session, col, func, select

from app.models.sold_out_watch import SoldOutWatch


def get_watch_for_user(*, session: Session, user_id: UUID) -> SoldOutWatch | None:
    return session.exec(
        select(SoldOutWatch).where(SoldOutWatch.user_id == user_id)
    ).first()


def count_active_watches(*, session: Session) -> int:
    return session.exec(select(func.count()).select_from(SoldOutWatch)).one()


def set_watch_for_user(
    *, session: Session, user_id: UUID, showtime_id: int, now: datetime
) -> SoldOutWatch:
    """Point this user's single watch at `showtime_id`, replacing any other.

    Moving an existing row rather than deleting and inserting keeps the
    one-per-user unique constraint from ever seeing two rows at once, and
    resets the back-off — a watch just pointed somewhere new has looked at the
    new showtime exactly zero times.
    """
    watch = get_watch_for_user(session=session, user_id=user_id)
    if watch is None:
        watch = SoldOutWatch(user_id=user_id, showtime_id=showtime_id)
    watch.showtime_id = showtime_id
    watch.created_at = now
    watch.next_check_at = now
    watch.last_checked_at = None
    watch.checks_done = 0
    session.add(watch)
    return watch


def delete_watch_for_user(*, session: Session, user_id: UUID) -> bool:
    watch = get_watch_for_user(session=session, user_id=user_id)
    if watch is None:
        return False
    session.delete(watch)
    return True


def get_due_watches(*, session: Session, now: datetime) -> list[SoldOutWatch]:
    return list(
        session.exec(
            select(SoldOutWatch)
            .where(col(SoldOutWatch.next_check_at) <= now)
            .order_by(col(SoldOutWatch.next_check_at).asc())
        ).all()
    )
