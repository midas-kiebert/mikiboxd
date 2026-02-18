import datetime as dt

from sqlalchemy import UniqueConstraint
from sqlmodel import Field, SQLModel

__all__ = [
    "ShowtimeSourcePresence",
]


class ShowtimeSourcePresence(SQLModel, table=True):
    __table_args__ = (
        UniqueConstraint(
            "source_stream",
            "source_event_key",
            name="uq_showtime_source_event",
        ),
    )
    id: int = Field(primary_key=True)
    source_stream: str = Field(index=True)
    source_event_key: str = Field(index=True)
    showtime_id: int = Field(
        foreign_key="showtime.id",
        ondelete="CASCADE",
        index=True,
    )
    last_seen_run_id: int | None = Field(
        default=None,
        foreign_key="scraperun.id",
        index=True,
    )
    last_seen_at: dt.datetime = Field(index=True)
    missing_streak: int = 0
    active: bool = Field(default=True, index=True)
