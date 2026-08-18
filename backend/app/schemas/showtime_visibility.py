from sqlmodel import SQLModel

from app.core.enums import VisibilityMode
from app.schemas.user import UserPublic

__all__ = [
    "ShowtimeVisibilityPublic",
    "ShowtimeVisibilityUpdate",
    "UninvitedSelectedFriendsPublic",
]


class ShowtimeVisibilityUpdate(SQLModel):
    mode: VisibilityMode


class ShowtimeVisibilityPublic(SQLModel):
    showtime_id: int
    movie_id: int
    mode: VisibilityMode


class UninvitedSelectedFriendsPublic(SQLModel):
    friends: list[UserPublic]
