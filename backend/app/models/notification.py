"""Notification — a stored notification-centre entry for a single recipient.

Only event types that are not already persisted as their own actionable entity
are stored here (see ``NotificationType``). Received invites stay as
``ShowtimePing`` rows and received friend requests stay as ``FriendRequest``
rows; the notification-centre feed merges all three sources at read time.

The unique constraint lets a repeated event (for example a friend re-marking
going on the same showtime) upsert the existing row instead of piling up
duplicates, and lets the matching row be deleted when the event is undone.
"""

from datetime import datetime
from uuid import UUID

from sqlalchemy import Enum as SAEnum
from sqlalchemy import UniqueConstraint
from sqlmodel import Column, Field, SQLModel

from app.core.enums import NotificationType
from app.utils import now_amsterdam_naive


class Notification(SQLModel, table=True):
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "type",
            "actor_id",
            "showtime_id",
            name="uq_notification_user_type_actor_showtime",
        ),
    )

    id: int | None = Field(default=None, primary_key=True)
    # Recipient of the notification.
    user_id: UUID = Field(
        foreign_key="user.id",
        nullable=False,
        ondelete="CASCADE",
        index=True,
    )
    type: NotificationType = Field(
        # Store the enum *value* (e.g. "friend_showtime_match") rather than the
        # member name, so the column is human-readable and matches the string the
        # API exposes.
        sa_column=Column(
            SAEnum(
                NotificationType,
                native_enum=False,
                values_callable=lambda enum: [member.value for member in enum],
            ),
            nullable=False,
        ),
    )
    # User whose action triggered the notification (friend / sender / accepter).
    actor_id: UUID | None = Field(
        default=None,
        foreign_key="user.id",
        ondelete="CASCADE",
        index=True,
    )
    # Showtime the notification refers to, for showtime-related types.
    showtime_id: int | None = Field(
        default=None,
        foreign_key="showtime.id",
        ondelete="CASCADE",
        index=True,
    )
    created_at: datetime = Field(default_factory=now_amsterdam_naive, nullable=False)
    seen_at: datetime | None = Field(default=None, nullable=True)
    dismissed_at: datetime | None = Field(default=None, nullable=True)
