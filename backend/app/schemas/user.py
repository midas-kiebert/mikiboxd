from typing import TYPE_CHECKING
from uuid import UUID

from sqlmodel import SQLModel

if TYPE_CHECKING:
    from .showtime import ShowtimeLoggedIn

__all__ = [
    "UserPublic",
    "UserWithFriendStatus",
    "UserWithShowtimesPublic",
]


class UserPublic(SQLModel):
    id: UUID
    is_active: bool
    display_name: str | None


class UserWithFriendStatus(UserPublic):
    is_friend: bool
    sent_request: bool
    received_request: bool


class UserWithShowtimesPublic(UserPublic):
    showtimes_going: list["ShowtimeLoggedIn"]
