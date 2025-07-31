from uuid import UUID

from sqlmodel import Field, SQLModel

__all__ = [
    "Friendship",
    "FriendRequest",
]


class Friendship(SQLModel, table=True):
    user_id: UUID = Field(foreign_key="user.id", primary_key=True)
    friend_id: UUID = Field(foreign_key="user.id", primary_key=True)


class FriendRequest(SQLModel, table=True):
    sender_id: UUID = Field(foreign_key="user.id", primary_key=True)
    receiver_id: UUID = Field(foreign_key="user.id", primary_key=True)

    status: str = Field(default="pending")  # pending, accepted, declined
