from collections.abc import Sequence
from typing import TYPE_CHECKING
from uuid import UUID

from pydantic import BaseModel

from app.core.enums import GoingStatus
from app.models.showtime import ShowtimeBase

if TYPE_CHECKING:
    from .cinema import CinemaPublic
    from .movie import MovieInShowtime
    from .user import UserPublic


__all__ = [
    "ShowtimeLoggedIn",
    "ShowtimeInMovieLoggedIn",
]


class ShowtimeSelectionUpdate(BaseModel):
    going_status: GoingStatus
    seat_row: str | None = None
    seat_number: str | None = None
    visible_friend_ids: list[UUID] | None = None
    visible_group_ids: list[UUID] | None = None


class ShowtimeLoggedIn(ShowtimeBase):
    id: int
    movie: "MovieInShowtime"
    cinema: "CinemaPublic"
    friends_going: Sequence["UserPublic"]
    friends_interested: Sequence["UserPublic"]
    going: GoingStatus
    seat_row: str | None = None
    seat_number: str | None = None
    # Unique senders of the current user's active (non-dismissed) received pings
    # for this showtime, plus those pings' ids (used to dismiss the invite).
    invited_by: Sequence["UserPublic"] = []
    invite_ping_ids: Sequence[int] = []


# For responses inside of a Movie model
class ShowtimeInMovieLoggedIn(ShowtimeBase):
    id: int
    cinema: "CinemaPublic"
    friends_going: Sequence["UserPublic"]
    friends_interested: Sequence["UserPublic"]
    going: GoingStatus
    seat_row: str | None = None
    seat_number: str | None = None
    invited_by: Sequence["UserPublic"] = []
    invite_ping_ids: Sequence[int] = []
