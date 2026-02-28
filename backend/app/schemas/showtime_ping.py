from datetime import datetime as DateTime

from sqlmodel import SQLModel

from .showtime import ShowtimeLoggedIn
from .user import UserPublic

__all__ = [
    "ShowtimePingPublic",
]


class ShowtimePingPublic(SQLModel):
    id: int
    showtime_id: int
    movie_id: int
    movie_title: str
    movie_poster_link: str | None
    cinema_name: str
    datetime: DateTime
    ticket_link: str | None
    showtime: ShowtimeLoggedIn
    sender: UserPublic
    created_at: DateTime
    seen_at: DateTime | None
