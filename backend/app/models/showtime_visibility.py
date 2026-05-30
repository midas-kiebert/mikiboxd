"""Showtime visibility models.

Four tables work together to control who can see whose showtime attendance:

- ShowtimeVisibilitySetting  — per (owner, showtime): is visibility open to all
  friends, or restricted to specific friends/groups?
- ShowtimeVisibilityFriend   — explicit allow-list: (owner, showtime) → viewer
- ShowtimeVisibilityGroup    — group-based allow-list: (owner, showtime) → group
- ShowtimeVisibilityEffective — denormalized read cache: (owner, showtime) → viewer
  rows that are materialized from the three tables above.

Write paths update Setting/Friend/Group. Read paths query only Effective.
"""

from datetime import datetime
from uuid import UUID

from sqlmodel import Field, SQLModel

from app.utils import now_amsterdam_naive


class ShowtimeVisibilitySetting(SQLModel, table=True):
    """Whether a user's attendance for a showtime is visible to all friends or restricted."""

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
    """Explicit friend-level allow: viewer_id may see owner's attendance for showtime_id."""

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
    """Group-level allow: all members of group_id may see owner's attendance for showtime_id."""

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
