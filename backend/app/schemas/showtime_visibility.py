from uuid import UUID

from sqlmodel import Field, SQLModel

__all__ = [
    "ShowtimeVisibilityPublic",
    "ShowtimeVisibilityUpdate",
]


class ShowtimeVisibilityUpdate(SQLModel):
    visible_friend_ids: list[UUID] = Field(default_factory=list)
    visible_group_ids: list[UUID] = Field(default_factory=list)


class ShowtimeVisibilityPublic(SQLModel):
    showtime_id: int
    movie_id: int
    visible_friend_ids: list[UUID] = Field(default_factory=list)
    visible_group_ids: list[UUID] = Field(default_factory=list)
    all_friends_selected: bool
