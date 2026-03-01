from uuid import UUID

from sqlmodel import Field, SQLModel

__all__ = [
    "Friendship",
    "FriendRequest",
]


class Friendship(SQLModel, table=True):
    user_id: UUID = Field(foreign_key="user.id", ondelete="CASCADE", primary_key=True)
    friend_id: UUID = Field(foreign_key="user.id", ondelete="CASCADE", primary_key=True)


class FriendRequest(SQLModel, table=True):
    sender_id: UUID = Field(foreign_key="user.id", ondelete="CASCADE", primary_key=True)
    receiver_id: UUID = Field(
        foreign_key="user.id", ondelete="CASCADE", primary_key=True
    )
