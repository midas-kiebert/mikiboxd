"""Saved preset model — user-saved, partial filter + cinema configurations.

Unlike the legacy :class:`~app.models.filter_preset.FilterPreset` (which always
stores the *full* filter set and is applied as a complete replacement), a
``SavedPreset`` records only the dimensions the user chose to include
(``included_fields``) plus an optional cinema selection. Applying one sets only
those dimensions and leaves every other active filter untouched.
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, UniqueConstraint
from sqlalchemy import Enum as SAEnum
from sqlmodel import Column, Field, SQLModel

from app.core.enums import FilterPresetScope
from app.utils import now_amsterdam_naive


class SavedPreset(SQLModel, table=True):
    __table_args__ = (
        UniqueConstraint(
            "owner_user_id",
            "scope",
            "name",
            name="uq_saved_preset_owner_scope_name",
        ),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    owner_user_id: uuid.UUID = Field(
        foreign_key="user.id",
        ondelete="CASCADE",
        index=True,
    )
    name: str = Field(max_length=80)
    scope: FilterPresetScope = Field(
        sa_column=Column(
            SAEnum(FilterPresetScope, native_enum=False), nullable=False, index=True
        ),
    )
    is_favorite: bool = Field(default=False, nullable=False, index=True)
    # Which dimensions this preset applies. Tokens come from
    # ``app.schemas.saved_preset.INCLUDABLE_FIELDS``.
    included_fields: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False),
    )
    # Full filter snapshot; only the keys named in ``included_fields`` are
    # meaningful when applying. Non-included keys are ignored.
    filters: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(JSON, nullable=False),
    )
    # Cinema selection, only meaningful when "cinemas" is in ``included_fields``.
    # ``None`` means the preset does not touch the cinema selection.
    cinema_ids: list[int] | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    created_at: datetime = Field(default_factory=now_amsterdam_naive, nullable=False)
    updated_at: datetime = Field(default_factory=now_amsterdam_naive, nullable=False)
