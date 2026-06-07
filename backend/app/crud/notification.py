"""CRUD for notification-centre entries (see ``models/notification.py``).

These rows back the three event types that are not persisted elsewhere; received
invites and friend requests are read from their own tables and merged into the
feed at the service layer.
"""

from datetime import datetime, timedelta
from uuid import UUID

from sqlalchemy import func
from sqlmodel import Session, col, select

from app.core.enums import NotificationType
from app.models.notification import Notification
from app.models.showtime import Showtime


def upsert_notification(
    *,
    session: Session,
    user_id: UUID,
    type: NotificationType,
    actor_id: UUID | None,
    showtime_id: int | None,
    created_at: datetime,
) -> Notification:
    """Create the notification, or re-surface an existing matching one.

    A repeated event (same recipient/type/actor/showtime) refreshes the existing
    row — bumping ``created_at`` and clearing ``seen_at``/``dismissed_at`` so it
    rises back to the top of the feed and re-counts as unseen.
    """
    stmt = select(Notification).where(
        Notification.user_id == user_id,
        Notification.type == type,
        _matches(Notification.actor_id, actor_id),
        _matches(Notification.showtime_id, showtime_id),
    )
    existing = session.exec(stmt).one_or_none()
    if existing is not None:
        existing.created_at = created_at
        existing.seen_at = None
        existing.dismissed_at = None
        session.add(existing)
        session.flush()
        return existing

    notification = Notification(
        user_id=user_id,
        type=type,
        actor_id=actor_id,
        showtime_id=showtime_id,
        created_at=created_at,
    )
    session.add(notification)
    session.flush()
    return notification


def delete_showtime_notifications(
    *,
    session: Session,
    actor_id: UUID,
    showtime_id: int,
    types: list[NotificationType],
    user_id: UUID | None = None,
) -> int:
    """Delete an actor's showtime notifications (used when they deselect).

    Removes every recipient's rows by default; pass ``user_id`` to scope to a
    single recipient (used to dedupe match vs invite_response).
    """
    stmt = select(Notification).where(
        Notification.actor_id == actor_id,
        Notification.showtime_id == showtime_id,
        col(Notification.type).in_(types),
    )
    if user_id is not None:
        stmt = stmt.where(Notification.user_id == user_id)
    rows = list(session.exec(stmt).all())
    for row in rows:
        session.delete(row)
    session.flush()
    return len(rows)


def get_feed_notifications(
    *,
    session: Session,
    user_id: UUID,
    limit: int,
    offset: int,
) -> list[Notification]:
    """Non-dismissed notifications for a recipient, newest first."""
    stmt = (
        select(Notification)
        .where(
            Notification.user_id == user_id,
            col(Notification.dismissed_at).is_(None),
        )
        .order_by(col(Notification.created_at).desc(), col(Notification.id).desc())
        .limit(limit)
        .offset(offset)
    )
    return list(session.exec(stmt).all())


def get_unseen_count(*, session: Session, user_id: UUID) -> int:
    stmt = (
        select(func.count())
        .select_from(Notification)
        .where(
            Notification.user_id == user_id,
            col(Notification.seen_at).is_(None),
            col(Notification.dismissed_at).is_(None),
        )
    )
    return int(session.exec(stmt).one() or 0)


def mark_seen(*, session: Session, user_id: UUID, seen_at: datetime) -> int:
    stmt = select(Notification).where(
        Notification.user_id == user_id,
        col(Notification.seen_at).is_(None),
        col(Notification.dismissed_at).is_(None),
    )
    unseen = list(session.exec(stmt).all())
    for notification in unseen:
        notification.seen_at = seen_at
        session.add(notification)
    session.flush()
    return len(unseen)


def dismiss(
    *,
    session: Session,
    notification_id: int,
    user_id: UUID,
    dismissed_at: datetime,
) -> bool:
    stmt = select(Notification).where(
        Notification.id == notification_id,
        Notification.user_id == user_id,
    )
    notification = session.exec(stmt).one_or_none()
    if notification is None:
        return False
    notification.dismissed_at = dismissed_at
    session.add(notification)
    session.flush()
    return True


def delete_past_showtime_notifications(
    *,
    session: Session,
    user_id: UUID,
    now: datetime,
) -> int:
    """Prune a recipient's notifications whose showtime has already started."""
    stmt = (
        select(Notification)
        .join(Showtime, col(Showtime.id) == col(Notification.showtime_id))
        .where(
            Notification.user_id == user_id,
            col(Showtime.datetime) < now,
        )
    )
    rows = list(session.exec(stmt).all())
    for row in rows:
        session.delete(row)
    session.flush()
    return len(rows)


def delete_stale_notifications(
    *,
    session: Session,
    now: datetime,
    max_age: timedelta,
) -> int:
    """Decay: drop dismissed rows and anything older than ``max_age`` (all users)."""
    cutoff = now - max_age
    stmt = select(Notification).where(
        col(Notification.dismissed_at).is_not(None)
        | (col(Notification.created_at) < cutoff)
    )
    rows = list(session.exec(stmt).all())
    for row in rows:
        session.delete(row)
    session.flush()
    return len(rows)


def _matches(column, value):  # type: ignore[no-untyped-def]
    """Equality that also matches on NULL (the unique key allows null columns)."""
    if value is None:
        return col(column).is_(None)
    return column == value
