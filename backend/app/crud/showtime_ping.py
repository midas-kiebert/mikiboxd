from datetime import datetime
from uuid import UUID

from sqlalchemy import func
from sqlmodel import Session, col, select

from app.models.showtime_ping import ShowtimePing


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


def get_received_showtime_pings(
    *,
    session: Session,
    receiver_id: UUID,
    limit: int,
    offset: int,
) -> list[ShowtimePing]:
    stmt = (
        select(ShowtimePing)
        .where(ShowtimePing.receiver_id == receiver_id)
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
    )
    unseen_pings = list(session.exec(stmt).all())
    for ping in unseen_pings:
        ping.seen_at = seen_at
        session.add(ping)
    session.flush()
    return len(unseen_pings)
