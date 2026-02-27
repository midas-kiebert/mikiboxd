import datetime as dt
from typing import TYPE_CHECKING

from sqlalchemy import String, UniqueConstraint
from sqlalchemy.dialects.postgresql import ARRAY
from sqlmodel import Column, Field, Relationship, SQLModel

if TYPE_CHECKING:
    from .cinema import Cinema
    from .movie import Movie

__all__ = [
    "ShowtimeBase",
    "ShowtimeCreate",
    "Showtime",
]


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
    movie_id: int = Field(foreign_key="movie.id")
    movie: "Movie" = Relationship(sa_relationship_kwargs={"lazy": "joined"})
    cinema_id: int = Field(foreign_key="cinema.id")
    cinema: "Cinema" = Relationship(sa_relationship_kwargs={"lazy": "joined"})
