"""Per-source record of movies already accounted for in the watchlist digest.

A row here means the source's owner either received this movie in a digest
email sent for this source, or was already GOING/INTERESTED in one of its
showtimes when the source was evaluated — either way it must never be sent
to them again *for that source*. Keyed per source rather than per user so
that two sources belonging to the same user (different cinema restrictions,
different lists) are notified about the same movie independently.
"""

from datetime import datetime
from uuid import UUID

from sqlmodel import Field, SQLModel

from app.utils import now_amsterdam_naive


class WatchlistDigestNotifiedMovie(SQLModel, table=True):
    source_id: UUID = Field(
        foreign_key="watchlistdigestsource.id", ondelete="CASCADE", primary_key=True
    )
    movie_id: int = Field(foreign_key="movie.id", ondelete="CASCADE", primary_key=True)
    notified_at: datetime = Field(default_factory=now_amsterdam_naive, nullable=False)
