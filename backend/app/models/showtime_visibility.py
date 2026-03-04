from datetime import datetime
from uuid import UUID

from sqlmodel import Field, SQLModel

from app.utils import now_amsterdam_naive

__all__ = [
    "ShowtimeVisibilitySetting",
    "ShowtimeVisibilityFriend",
    "ShowtimeVisibilityGroup",
    "ShowtimeVisibilityEffective",
]


class ShowtimeVisibilitySetting(SQLModel, table=True):
    owner_id: UUID = Field(
        foreign_key="user.id",
        primary_key=True,
        ondelete="CASCADE",
    )
    showtime_id: int = Field(
        foreign_key="showtime.id",
        primary_key=True,
        ondelete="CASCADE",
    )
    is_all_friends: bool = Field(default=True, nullable=False)
    updated_at: datetime = Field(default_factory=now_amsterdam_naive, nullable=False)


class ShowtimeVisibilityFriend(SQLModel, table=True):
    owner_id: UUID = Field(
        foreign_key="user.id",
        primary_key=True,
        ondelete="CASCADE",
    )
    showtime_id: int = Field(
        foreign_key="showtime.id",
        primary_key=True,
        ondelete="CASCADE",
    )
    viewer_id: UUID = Field(
        foreign_key="user.id",
        primary_key=True,
        ondelete="CASCADE",
    )
    created_at: datetime = Field(default_factory=now_amsterdam_naive, nullable=False)


class ShowtimeVisibilityGroup(SQLModel, table=True):
    owner_id: UUID = Field(
        foreign_key="user.id",
        primary_key=True,
        ondelete="CASCADE",
    )
    showtime_id: int = Field(
        foreign_key="showtime.id",
        primary_key=True,
        ondelete="CASCADE",
    )
    group_id: UUID = Field(
        foreign_key="friendgroup.id",
        primary_key=True,
        ondelete="CASCADE",
    )
    created_at: datetime = Field(default_factory=now_amsterdam_naive, nullable=False)


class ShowtimeVisibilityEffective(SQLModel, table=True):
    """
    Denormalized per-showtime visibility edges used by read paths.
    A row means: viewer_id can see owner_id's status for showtime_id.
    """

    owner_id: UUID = Field(
        foreign_key="user.id",
        primary_key=True,
        ondelete="CASCADE",
    )
    showtime_id: int = Field(
        foreign_key="showtime.id",
        primary_key=True,
        ondelete="CASCADE",
    )
    viewer_id: UUID = Field(
        foreign_key="user.id",
        primary_key=True,
        ondelete="CASCADE",
        index=True,
    )
