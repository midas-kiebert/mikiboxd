import re
from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import field_validator
from sqlmodel import Field, SQLModel

from app.core.enums import FilterPresetScope

__all__ = [
    "FilterPresetFilters",
    "FilterPresetCreate",
    "FilterPresetPublic",
]

ISO_DAY_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
WEEKDAY_DAY_PATTERN = re.compile(r"^weekday:[1-7]$")
RELATIVE_DAY_TOKENS = frozenset(
    {
        "relative:today",
        "relative:tomorrow",
        "relative:day_after_tomorrow",
    }
)
DAY_SELECTION_VALIDATION_ERROR = (
    "Day selections must be ISO dates (YYYY-MM-DD), relative day tokens, "
    "or weekday tokens."
)


class FilterPresetFilters(SQLModel):
    selected_showtime_filter: Literal["all", "interested", "going"] | None = None
    watchlist_only: bool = False
    days: list[str] | None = None
    time_ranges: list[str] | None = None

    @field_validator("days")
    @classmethod
    def validate_days(cls, values: list[str] | None) -> list[str] | None:
        if values is None:
            return None

        for value in values:
            if value in RELATIVE_DAY_TOKENS:
                continue
            if WEEKDAY_DAY_PATTERN.fullmatch(value):
                continue
            if ISO_DAY_PATTERN.fullmatch(value):
                try:
                    date.fromisoformat(value)
                except ValueError as exc:
                    raise ValueError(f"Invalid ISO day selection: {value}") from exc
                continue
            raise ValueError(DAY_SELECTION_VALIDATION_ERROR)

        return values


class FilterPresetCreate(SQLModel):
    name: str = Field(min_length=1, max_length=80)
    scope: FilterPresetScope
    filters: FilterPresetFilters
    is_favorite: bool | None = None


class FilterPresetPublic(SQLModel):
    id: UUID
    name: str
    scope: FilterPresetScope
    is_default: bool
    is_favorite: bool
    filters: FilterPresetFilters
    created_at: datetime
    updated_at: datetime
