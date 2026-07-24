"""Showtime models."""

import datetime as dt
from typing import TYPE_CHECKING

from sqlalchemy import String, UniqueConstraint
from sqlalchemy.dialects.postgresql import ARRAY
from sqlmodel import Column, Field, Relationship, SQLModel

from app.utils import now_amsterdam_naive

if TYPE_CHECKING:
    from .cinema import Cinema
    from .movie import Movie


# Shared properties
class ShowtimeBase(SQLModel):
    datetime: dt.datetime = Field(index=True)
    end_datetime: dt.datetime | None = None
    ticket_link: str | None = None
    subtitles: list[str] | None = Field(sa_column=Column(ARRAY(String)), default=None)


# Properties to receive on showtime creation
class ShowtimeCreate(ShowtimeBase):
    movie_id: int = Field(foreign_key="movie.id")
    cinema_id: int = Field(foreign_key="cinema.id")


class Showtime(ShowtimeBase, table=True):
    __table_args__ = (
        UniqueConstraint(
            "cinema_id",
            "datetime",
            "movie_id",
            name="uq_showtime_unique_fields",
        ),
    )
    id: int = Field(primary_key=True)
    # When this row was first inserted — used to detect showtimes that are
    # "new" within a lookback window (e.g. the watchlist digest), as opposed
    # to showtimes that merely became future-dated again.
    created_at: dt.datetime = Field(default_factory=now_amsterdam_naive)
    movie_id: int = Field(foreign_key="movie.id")
    movie: "Movie" = Relationship(sa_relationship_kwargs={"lazy": "joined"})
    cinema_id: int = Field(foreign_key="cinema.id")
    cinema: "Cinema" = Relationship(sa_relationship_kwargs={"lazy": "joined"})
