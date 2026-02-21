from typing import TYPE_CHECKING
from uuid import UUID

from pydantic import EmailStr
from sqlmodel import SQLModel

if TYPE_CHECKING:
    from .showtime import ShowtimeLoggedIn

__all__ = [
    "UserPublic",
    "UserMe",
    "UserWithFriendStatus",
    "UserWithShowtimesPublic",
]


class UserPublic(SQLModel):
    id: UUID
    is_active: bool
    display_name: str | None


class UserMe(UserPublic):
    email: EmailStr
    is_superuser: bool
    notify_on_friend_showtime_match: bool
    notify_on_friend_requests: bool
    notify_on_showtime_ping: bool
    notify_on_interest_reminder: bool
    letterboxd_username: str | None


class UserWithFriendStatus(UserPublic):
    is_friend: bool
    sent_request: bool
    received_request: bool


class UserWithShowtimesPublic(UserPublic):
    showtimes_going: list["ShowtimeLoggedIn"]
