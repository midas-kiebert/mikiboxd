from datetime import datetime

from sqlmodel import SQLModel

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
    datetime: datetime
    ticket_link: str | None
    sender: UserPublic
    created_at: datetime
    seen_at: datetime | None
