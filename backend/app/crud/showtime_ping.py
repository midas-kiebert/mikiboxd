from datetime import datetime
from uuid import UUID

from sqlalchemy import func
from sqlmodel import Session, col, select

from app.core.enums import ShowtimePingSort
from app.models.showtime import Showtime
from app.models.showtime_ping import ShowtimePing
from app.models.user import User


def get_showtime_ping(
    *,
    session: Session,
    showtime_id: int,
    sender_id: UUID,
    receiver_id: UUID,
) -> ShowtimePing | None:
    stmt = select(ShowtimePing).where(
        ShowtimePing.showtime_id == showtime_id,
        ShowtimePing.sender_id == sender_id,
        ShowtimePing.receiver_id == receiver_id,
    )
    return session.exec(stmt).one_or_none()


def get_showtime_ping_by_id(*, session: Session, ping_id: int) -> ShowtimePing | None:
    return session.get(ShowtimePing, ping_id)


def create_showtime_ping(
    *,
    session: Session,
    showtime_id: int,
    sender_id: UUID,
    receiver_id: UUID,
    created_at: datetime,
) -> ShowtimePing:
    ping = ShowtimePing(
        showtime_id=showtime_id,
        sender_id=sender_id,
        receiver_id=receiver_id,
        created_at=created_at,
    )
    session.add(ping)
    session.flush()
    return ping


def get_pinged_friend_ids_for_showtime(
    *,
    session: Session,
    showtime_id: int,
    sender_id: UUID,
) -> list[UUID]:
    stmt = (
        select(ShowtimePing.receiver_id)
        .where(
            ShowtimePing.showtime_id == showtime_id,
            ShowtimePing.sender_id == sender_id,
        )
        .order_by(col(ShowtimePing.created_at).desc())
    )
    return list(session.exec(stmt).all())


def get_sent_showtime_pings(
    *,
    session: Session,
    showtime_id: int,
    sender_id: UUID,
) -> list[tuple[ShowtimePing, str]]:
    """Return sent pings with receiver display names, newest first."""
    stmt = (
        select(ShowtimePing, User.display_name)
        .join(User, col(User.id) == col(ShowtimePing.receiver_id))
        .where(
            ShowtimePing.showtime_id == showtime_id,
            ShowtimePing.sender_id == sender_id,
        )
        .order_by(col(ShowtimePing.created_at).desc())
    )
    return list(session.exec(stmt).all())


def delete_sent_showtime_ping(
    *,
    session: Session,
    showtime_id: int,
    sender_id: UUID,
    receiver_id: UUID,
) -> bool:
    ping = get_showtime_ping(
        session=session,
        showtime_id=showtime_id,
        sender_id=sender_id,
        receiver_id=receiver_id,
    )
    if ping is None:
        return False
    session.delete(ping)
    session.flush()
    return True


def get_received_showtime_pings(
    *,
    session: Session,
    receiver_id: UUID,
    sort_by: ShowtimePingSort,
    limit: int,
    offset: int,
) -> list[ShowtimePing]:
    # Dismissed pings are hidden from the receiver's list — they stay in the DB
    # so the sender can see "dismissed" status, but the receiver never sees them again.
    dismissed_filter = col(ShowtimePing.dismissed_at).is_(None)
    if sort_by == ShowtimePingSort.SHOWTIME_DATETIME:
        stmt = (
            select(ShowtimePing)
            .join(Showtime, col(Showtime.id) == col(ShowtimePing.showtime_id))
            .where(ShowtimePing.receiver_id == receiver_id, dismissed_filter)
            .order_by(
                col(Showtime.datetime).desc(),
                col(ShowtimePing.created_at).desc(),
                col(ShowtimePing.id).desc(),
            )
            .limit(limit)
            .offset(offset)
        )
    else:
        stmt = (
            select(ShowtimePing)
            .where(ShowtimePing.receiver_id == receiver_id, dismissed_filter)
            .order_by(col(ShowtimePing.created_at).desc(), col(ShowtimePing.id).desc())
            .limit(limit)
            .offset(offset)
        )
    return list(session.exec(stmt).all())


def get_unseen_showtime_ping_count(
    *,
    session: Session,
    receiver_id: UUID,
) -> int:
    stmt = (
        select(func.count())
        .select_from(ShowtimePing)
        .where(
            ShowtimePing.receiver_id == receiver_id,
            col(ShowtimePing.seen_at).is_(None),
            col(ShowtimePing.dismissed_at).is_(None),
        )
    )
    count = session.exec(stmt).one()
    return int(count or 0)


def mark_received_showtime_pings_seen(
    *,
    session: Session,
    receiver_id: UUID,
    seen_at: datetime,
) -> int:
    stmt = select(ShowtimePing).where(
        ShowtimePing.receiver_id == receiver_id,
        col(ShowtimePing.seen_at).is_(None),
        col(ShowtimePing.dismissed_at).is_(None),
    )
    unseen_pings = list(session.exec(stmt).all())
    for ping in unseen_pings:
        ping.seen_at = seen_at
        session.add(ping)
    session.flush()
    return len(unseen_pings)


def dismiss_received_showtime_ping(
    *,
    session: Session,
    ping_id: int,
    receiver_id: UUID,
    dismissed_at: datetime,
) -> bool:
    stmt = select(ShowtimePing).where(
        ShowtimePing.id == ping_id,
        ShowtimePing.receiver_id == receiver_id,
    )
    ping = session.exec(stmt).one_or_none()
    if ping is None:
        return False
    ping.dismissed_at = dismissed_at
    session.add(ping)
    session.flush()
    return True


def delete_received_showtime_ping(
    *,
    session: Session,
    ping_id: int,
    receiver_id: UUID,
) -> bool:
    stmt = select(ShowtimePing).where(
        ShowtimePing.id == ping_id,
        ShowtimePing.receiver_id == receiver_id,
    )
    ping = session.exec(stmt).one_or_none()
    if ping is None:
        return False

    session.delete(ping)
    session.flush()
    return True


def delete_received_past_showtime_pings(
    *,
    session: Session,
    receiver_id: UUID,
    now: datetime,
) -> int:
    stmt = (
        select(ShowtimePing)
        .join(Showtime, col(Showtime.id) == col(ShowtimePing.showtime_id))
        .where(
            ShowtimePing.receiver_id == receiver_id,
            col(Showtime.datetime) < now,
        )
    )
    past_pings = list(session.exec(stmt).all())
    for ping in past_pings:
        session.delete(ping)
    session.flush()
    return len(past_pings)
