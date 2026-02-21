from datetime import datetime
from uuid import UUID

from sqlalchemy import UniqueConstraint
from sqlmodel import Field, SQLModel

from app.utils import now_amsterdam_naive

__all__ = [
    "ShowtimePing",
]


class ShowtimePing(SQLModel, table=True):
    __table_args__ = (
        UniqueConstraint(
            "showtime_id",
            "sender_id",
            "receiver_id",
            name="uq_showtime_ping_showtime_sender_receiver",
        ),
    )

    id: int | None = Field(default=None, primary_key=True)
    showtime_id: int = Field(
        foreign_key="showtime.id",
        nullable=False,
        ondelete="CASCADE",
        index=True,
    )
    sender_id: UUID = Field(
        foreign_key="user.id",
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
    created_at: datetime = Field(default_factory=now_amsterdam_naive, nullable=False)
    seen_at: datetime | None = Field(default=None, nullable=True)
