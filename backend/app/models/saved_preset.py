"""Saved preset model — user-saved, partial filter + cinema configurations.

A ``SavedPreset`` controls (clears + sets) every dimension *except* those the
user chose to leave alone (``untouched_fields``), plus an optional cinema
selection. Applying one resets each controlled dimension to the stored
snapshot and leaves the untouched dimensions — and the cinema selection,
unless ``cinema_ids`` is set — as they are.
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, UniqueConstraint
from sqlmodel import Column, Field, SQLModel

from app.utils import now_amsterdam_naive


class SavedPreset(SQLModel, table=True):
    __table_args__ = (
        UniqueConstraint(
            "owner_user_id",
            "name",
            name="uq_saved_preset_owner_name",
        ),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    owner_user_id: uuid.UUID = Field(
        foreign_key="user.id",
        ondelete="CASCADE",
        index=True,
    )
    name: str = Field(max_length=80)
    is_favorite: bool = Field(default=False, nullable=False, index=True)
    # Dimensions this preset leaves untouched on apply. Tokens come from
    # ``app.schemas.saved_preset.UNTOUCHABLE_FIELDS`` plus per-list ``list:<uuid>``
    # tokens. Empty means "control every dimension".
    untouched_fields: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False),
    )
    # Full filter snapshot. Every dimension is applied except those named in
    # ``untouched_fields``; a missing key clears that dimension to its default.
    filters: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(JSON, nullable=False),
    )
    # Cinema selection. ``None`` means the preset does not touch the cinema
    # selection; a list applies it.
    cinema_ids: list[int] | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    created_at: datetime = Field(default_factory=now_amsterdam_naive, nullable=False)
    updated_at: datetime = Field(default_factory=now_amsterdam_naive, nullable=False)
