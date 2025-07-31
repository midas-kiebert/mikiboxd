from datetime import datetime
from typing import TYPE_CHECKING

from app.models.movie import MovieBase

if TYPE_CHECKING:
    from .cinema import CinemaPublic
    from .showtime import ShowtimeInMovieLoggedIn
    from .user import UserPublic

__all__ = [
    "MovieSummaryLoggedIn",
    "MovieLoggedIn",
]


class MovieSummaryLoggedIn(MovieBase):
    showtimes: list["ShowtimeInMovieLoggedIn"]
    cinemas: list["CinemaPublic"]
    last_showtime_datetime: datetime | None
    total_showtimes: int
    friends_going: list["UserPublic"]
    going: bool


class MovieLoggedIn(MovieBase):
    showtimes: list["ShowtimeInMovieLoggedIn"]
