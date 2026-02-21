from uuid import UUID

from sqlmodel import SQLModel

__all__ = [
    "ShowtimeVisibilityPublic",
    "ShowtimeVisibilityUpdate",
]


class ShowtimeVisibilityUpdate(SQLModel):
    visible_friend_ids: list[UUID]


class ShowtimeVisibilityPublic(SQLModel):
    showtime_id: int
    movie_id: int
    visible_friend_ids: list[UUID]
    all_friends_selected: bool
