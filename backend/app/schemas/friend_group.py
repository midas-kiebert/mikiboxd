from datetime import datetime
from uuid import UUID

from pydantic import field_validator
from sqlmodel import Field, SQLModel

__all__ = [
    "FriendGroupCreate",
    "FriendGroupPublic",
]


class FriendGroupCreate(SQLModel):
    name: str = Field(min_length=1, max_length=80)
    friend_ids: list[UUID] = Field(default_factory=list)
    is_favorite: bool | None = None

    @field_validator("friend_ids")
    @classmethod
    def normalize_friend_ids(cls, friend_ids: list[UUID]) -> list[UUID]:
        return sorted(set(friend_ids), key=str)


class FriendGroupPublic(SQLModel):
    id: UUID
    name: str
    friend_ids: list[UUID]
    is_favorite: bool
    created_at: datetime
    updated_at: datetime
