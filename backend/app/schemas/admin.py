"""Request/response shapes for the superuser admin endpoints."""

import datetime as dt

from sqlmodel import SQLModel

from app.models.movie import MovieBase

__all__ = [
    "AdminMoviePublic",
    "AdminShowtimeUpdate",
    "AdminShowtimePublic",
]


class AdminMoviePublic(MovieBase):
    pass


class AdminShowtimeUpdate(SQLModel):
    datetime: dt.datetime | None = None
    end_datetime: dt.datetime | None = None
    ticket_link: str | None = None
    subtitles: list[str] | None = None
    movie_id: int | None = None
    cinema_id: int | None = None


class AdminShowtimePublic(SQLModel):
    id: int
    datetime: dt.datetime
    end_datetime: dt.datetime | None
    ticket_link: str | None
    subtitles: list[str] | None
    movie_id: int
    movie_title: str
    cinema_id: int
    cinema_name: str
    cinema_url: str
