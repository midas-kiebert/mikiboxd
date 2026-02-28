from datetime import datetime
from uuid import UUID

from sqlalchemy import Enum as SAEnum
from sqlmodel import Column, Field, SQLModel

from app.core.enums import GoingStatus
from app.utils import now_amsterdam_naive

__all__ = [
    "ShowtimeSelection",
]


class ShowtimeSelection(SQLModel, table=True):
    user_id: UUID = Field(foreign_key="user.id", primary_key=True)
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
