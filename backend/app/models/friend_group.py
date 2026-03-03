import uuid
from datetime import datetime
from uuid import UUID

from sqlalchemy import UniqueConstraint
from sqlmodel import Field, SQLModel

from app.utils import now_amsterdam_naive

__all__ = [
    "FriendGroup",
    "FriendGroupMember",
]


class FriendGroup(SQLModel, table=True):
    __table_args__ = (
        UniqueConstraint(
            "owner_user_id",
            "name",
            name="uq_friend_group_owner_name",
        ),
    )

    id: UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    owner_user_id: UUID = Field(
        foreign_key="user.id",
        ondelete="CASCADE",
        index=True,
    )
    name: str = Field(max_length=80)
    is_favorite: bool = Field(default=False, nullable=False, index=True)
    created_at: datetime = Field(default_factory=now_amsterdam_naive, nullable=False)
    updated_at: datetime = Field(default_factory=now_amsterdam_naive, nullable=False)


class FriendGroupMember(SQLModel, table=True):
    group_id: UUID = Field(
        foreign_key="friendgroup.id",
        ondelete="CASCADE",
        primary_key=True,
    )
    friend_id: UUID = Field(
        foreign_key="user.id",
        ondelete="CASCADE",
        primary_key=True,
        index=True,
    )
    created_at: datetime = Field(default_factory=now_amsterdam_naive, nullable=False)
