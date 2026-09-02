"""Cooldown record for the manual "remind a friend about a showtime" nudge.

One row per (showtime, receiver): the timestamp is always the most recent
reminder anyone sent that receiver for that showtime, so the 72h cooldown
applies across senders, not per sender-receiver pair.
"""

from datetime import datetime
from uuid import UUID

from sqlalchemy import UniqueConstraint
from sqlmodel import Field, SQLModel

from app.utils import now_amsterdam_naive


class ShowtimeReminder(SQLModel, table=True):
    __table_args__ = (
        UniqueConstraint(
            "showtime_id",
            "receiver_id",
            name="uq_showtime_reminder_showtime_receiver",
        ),
    )

    id: int | None = Field(default=None, primary_key=True)
    showtime_id: int = Field(
        foreign_key="showtime.id",
        nullable=False,
        ondelete="CASCADE",
        index=True,
    )
    receiver_id: UUID = Field(
        foreign_key="user.id",
        nullable=False,
        ondelete="CASCADE",
        index=True,
    )
    sender_id: UUID = Field(
        foreign_key="user.id",
        nullable=False,
        ondelete="CASCADE",
    )
    sent_at: datetime = Field(default_factory=now_amsterdam_naive, nullable=False)
