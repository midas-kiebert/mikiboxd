"""Showtime visibility models.

Two tables control who can see whose showtime attendance:

- ShowtimeVisibilitySetting  — per (owner, showtime): which visibility mode
  applies (all friends / favorite friends / invited only). A row exists only
  when the showtime's mode differs from the owner's default mode.
- ShowtimeVisibilityEffective — denormalized read cache: (owner, showtime) →
  viewer rows materialized from the setting (or owner default), the owner's
  favorite friends, and the pings exchanged for the showtime.

Write paths update Setting; read paths query only Effective.
"""

from datetime import datetime
from uuid import UUID

from sqlmodel import Field, SQLModel

from app.core.enums import VisibilityMode
from app.utils import now_amsterdam_naive


class ShowtimeVisibilitySetting(SQLModel, table=True):
    """Per-showtime visibility mode for a user's attendance status."""

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
    mode: VisibilityMode = Field(default=VisibilityMode.ALL_FRIENDS, nullable=False)
    updated_at: datetime = Field(default_factory=now_amsterdam_naive, nullable=False)


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
