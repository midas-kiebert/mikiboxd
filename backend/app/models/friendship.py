"""Friendship and friend request models.

Friendship is symmetric but stored as two rows: (A→B) and (B→A).
FriendRequest is directional: sender → receiver, deleted once accepted or rejected.
"""

from datetime import datetime
from uuid import UUID

from sqlmodel import Field, SQLModel

from app.utils import now_amsterdam_naive


class Friendship(SQLModel, table=True):
    user_id: UUID = Field(foreign_key="user.id", ondelete="CASCADE", primary_key=True)
    friend_id: UUID = Field(foreign_key="user.id", ondelete="CASCADE", primary_key=True)


class FriendRequest(SQLModel, table=True):
    sender_id: UUID = Field(foreign_key="user.id", ondelete="CASCADE", primary_key=True)
    receiver_id: UUID = Field(
        foreign_key="user.id", ondelete="CASCADE", primary_key=True
    )
    # Lets the notification centre time-sort requests alongside other entries.
    created_at: datetime = Field(default_factory=now_amsterdam_naive, nullable=False)
