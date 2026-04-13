"""Friendship and friend request models.

Friendship is symmetric but stored as two rows: (A→B) and (B→A).
FriendRequest is directional: sender → receiver, deleted once accepted or rejected.
"""

from uuid import UUID

from sqlmodel import Field, SQLModel


class Friendship(SQLModel, table=True):
    user_id: UUID = Field(foreign_key="user.id", ondelete="CASCADE", primary_key=True)
    friend_id: UUID = Field(foreign_key="user.id", ondelete="CASCADE", primary_key=True)


class FriendRequest(SQLModel, table=True):
    sender_id: UUID = Field(foreign_key="user.id", ondelete="CASCADE", primary_key=True)
    receiver_id: UUID = Field(
        foreign_key="user.id", ondelete="CASCADE", primary_key=True
    )
