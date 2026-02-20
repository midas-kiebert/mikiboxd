import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, UniqueConstraint
from sqlalchemy import Enum as SAEnum
from sqlmodel import Column, Field, SQLModel

from app.core.enums import FilterPresetScope
from app.utils import now_amsterdam_naive

__all__ = [
    "FilterPreset",
]


class FilterPreset(SQLModel, table=True):
    __table_args__ = (
        UniqueConstraint(
            "owner_user_id",
            "scope",
            "name",
            name="uq_filter_preset_owner_scope_name",
        ),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    owner_user_id: uuid.UUID | None = Field(
        default=None,
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
    is_default: bool = Field(default=False, nullable=False, index=True)
    filters: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(JSON, nullable=False),
    )
    created_at: datetime = Field(default_factory=now_amsterdam_naive, nullable=False)
    updated_at: datetime = Field(default_factory=now_amsterdam_naive, nullable=False)
