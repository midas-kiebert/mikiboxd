from collections.abc import Sequence
from typing import TYPE_CHECKING

from app.models.showtime import ShowtimeBase

if TYPE_CHECKING:
    from .cinema import CinemaPublic
    from .movie import MovieSummaryLoggedIn
    from .user import UserPublic


__all__ = [
    "ShowtimeLoggedIn",
    "ShowtimeInMovieLoggedIn",
]


class ShowtimeLoggedIn(ShowtimeBase):
    id: int
    movie: "MovieSummaryLoggedIn"
    cinema: "CinemaPublic"
    friends_going: Sequence["UserPublic"]
    going: bool


# For responses inside of a Movie model
class ShowtimeInMovieLoggedIn(ShowtimeBase):
    id: int
    cinema: "CinemaPublic"
    friends_going: Sequence["UserPublic"]
    going: bool
