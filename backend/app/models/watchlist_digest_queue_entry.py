"""Watchlist digest queue — movies that have just become newly available.

Populated once per movie by the daily discovery job in
``app/services/watchlist_digest.py`` and never removed: a movie enters this
queue exactly once, the first time it gets a showtime after having had none
at all (past or future) for at least 24 hours.
"""

from datetime import datetime

from sqlmodel import Field, SQLModel

from app.utils import now_amsterdam_naive


class WatchlistDigestQueueEntry(SQLModel, table=True):
    movie_id: int = Field(foreign_key="movie.id", ondelete="CASCADE", primary_key=True)
    added_at: datetime = Field(default_factory=now_amsterdam_naive, nullable=False)
