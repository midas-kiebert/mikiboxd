"""Tombstone recording a showtime an admin deleted from the reports page.

A hard `DELETE FROM showtime` alone isn't enough: the next scrape of the same
cinema page re-upserts the identical (movie_id, cinema_id, datetime) row right
back into existence. This table lets `upsert_showtime` recognize "an admin
already removed this one" and skip recreating it.
"""

import datetime as dt

from sqlalchemy import UniqueConstraint
from sqlmodel import Field, SQLModel

from app.utils import now_amsterdam_naive


class DeletedShowtime(SQLModel, table=True):
    __table_args__ = (
        UniqueConstraint(
            "cinema_id",
            "datetime",
            "movie_id",
            name="uq_deletedshowtime_unique_fields",
        ),
    )
    id: int | None = Field(default=None, primary_key=True)
    movie_id: int = Field(foreign_key="movie.id", ondelete="CASCADE")
    cinema_id: int = Field(foreign_key="cinema.id", ondelete="CASCADE")
    datetime: dt.datetime
    deleted_at: dt.datetime = Field(default_factory=now_amsterdam_naive)
