from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID

from app.models.user import UserBase

if TYPE_CHECKING:
    from .showtime import ShowtimeLoggedIn

__all__ = [
    "UserPublic",
    "UserWithFriendStatus",
    "UserWithShowtimesPublic",
]


class UserPublic(UserBase):
    id: UUID
    last_watchlist_sync: datetime | None


class UserWithFriendStatus(UserPublic):
    is_friend: bool
    sent_request: bool
    received_request: bool


class UserWithShowtimesPublic(UserPublic):
    showtimes_going: list["ShowtimeLoggedIn"]
