from datetime import date, datetime
from typing import Literal
from uuid import UUID

from sqlmodel import Field, SQLModel

from app.core.enums import FilterPresetScope

__all__ = [
    "FilterPresetFilters",
    "FilterPresetCreate",
    "FilterPresetPublic",
]


class FilterPresetFilters(SQLModel):
    selected_showtime_filter: Literal["all", "interested", "going"] | None = None
    watchlist_only: bool = False
    selected_cinema_ids: list[int] | None = None
    days: list[date] | None = None
    time_ranges: list[str] | None = None


class FilterPresetCreate(SQLModel):
    name: str = Field(min_length=1, max_length=80)
    scope: FilterPresetScope
    filters: FilterPresetFilters


class FilterPresetPublic(SQLModel):
    id: UUID
    name: str
    scope: FilterPresetScope
    is_default: bool
    filters: FilterPresetFilters
    created_at: datetime
    updated_at: datetime
