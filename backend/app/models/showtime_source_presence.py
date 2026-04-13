"""Showtime source presence tracking.

Tracks whether a showtime is still being seen in a scrape source stream.
Used to soft-delete showtimes that have disappeared from a source.
"""

import datetime as dt

from sqlalchemy import UniqueConstraint
from sqlmodel import Field, SQLModel


class ShowtimeSourcePresence(SQLModel, table=True):
    """One row per (source_stream, source_event_key) pair observed during scraping.

    source_stream    — identifies the scraper (e.g. "pathé-amsterdam")
    source_event_key — the source's own stable identifier for this showtime
    missing_streak   — how many consecutive runs the showtime was absent; resets to 0 on re-appearance
    active           — False once missing_streak exceeds the soft-delete threshold
    """
    __table_args__ = (
        UniqueConstraint(
            "source_stream",
            "source_event_key",
            name="uq_showtime_source_event",
        ),
    )
    id: int | None = Field(default=None, primary_key=True)
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
