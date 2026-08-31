"""Showtime selection — a user's attendance record for a specific showtime."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import Enum as SAEnum
from sqlmodel import Column, Field, SQLModel

from app.core.enums import GoingStatus
from app.utils import now_amsterdam_naive


class ShowtimeSelection(SQLModel, table=True):
    user_id: UUID = Field(foreign_key="user.id", ondelete="CASCADE", primary_key=True)
    showtime_id: int = Field(
        foreign_key="showtime.id",
        ondelete="CASCADE",
        primary_key=True,
    )
    going_status: GoingStatus = Field(
        default=GoingStatus.GOING,
        sa_column=Column(SAEnum(GoingStatus, native_enum=False), nullable=False),
    )
    seat_row: str | None = Field(default=None, max_length=32, nullable=True)
    seat_number: str | None = Field(default=None, max_length=32, nullable=True)
    created_at: datetime = Field(default_factory=now_amsterdam_naive, nullable=False)
    updated_at: datetime = Field(default_factory=now_amsterdam_naive, nullable=False)
    interested_reminder_sent_at: datetime | None = Field(default=None, nullable=True)
    # When this user was told this screening was nearly sold out. Set once and
    # never cleared: the alert fires on the way up and only the first time, so
    # a screening hovering around the threshold cannot notify twice.
    seat_alert_sent_at: datetime | None = Field(default=None, nullable=True)
    # When this user was told this screening had actually sold out. A separate
    # stamp from the one above because it is a separate notice with its own
    # preference: someone can want to hear that a screening is gone without
    # wanting to be hurried while it still has seats, or the other way round.
    sold_out_alert_sent_at: datetime | None = Field(default=None, nullable=True)
