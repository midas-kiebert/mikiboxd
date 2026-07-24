"""Per-user record of movies already accounted for in the watchlist digest.

A row here means the user either received this movie in a digest email, or
was already GOING/INTERESTED in one of its showtimes when it was evaluated —
either way it must never be sent to them again.
"""

from datetime import datetime
from uuid import UUID

from sqlmodel import Field, SQLModel

from app.utils import now_amsterdam_naive


class WatchlistDigestNotifiedMovie(SQLModel, table=True):
    user_id: UUID = Field(foreign_key="user.id", ondelete="CASCADE", primary_key=True)
    movie_id: int = Field(foreign_key="movie.id", ondelete="CASCADE", primary_key=True)
    notified_at: datetime = Field(default_factory=now_amsterdam_naive, nullable=False)
