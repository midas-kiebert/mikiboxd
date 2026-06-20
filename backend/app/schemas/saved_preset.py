import re
from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import field_validator
from sqlmodel import Field, SQLModel

__all__ = [
    "UNTOUCHABLE_FIELDS",
    "LIST_FIELD_PREFIX",
    "is_list_field",
    "SavedPresetFilters",
    "SavedPresetCreate",
    "SavedPresetPublic",
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

# Prefix marking a per-list opt-out token, e.g. ``list:<uuid>``. A list token in
# ``untouched_fields`` means "leave that Letterboxd list's selection as-is".
LIST_FIELD_PREFIX = "list:"

# The non-list dimensions a preset may opt out of controlling. A preset controls
# (clears + sets) every dimension *except* the ones named here. ``cinemas`` is
# deliberately absent: the cinema selection is opt-*in* and driven by
# ``cinema_ids`` rather than by this set.
UNTOUCHABLE_FIELDS = frozenset(
    {
        "selected_showtime_filter",
        "showtime_audience",
        "watchlist_only",
        "hide_watched",
        "days",
        "time_ranges",
        "runtime_ranges",
        "group_by_movie",
    }
)

UNTOUCHED_FIELDS_VALIDATION_ERROR = (
    "untouched_fields entries must be one of "
    + ", ".join(sorted(UNTOUCHABLE_FIELDS))
    + " or a list token of the form 'list:<uuid>'"
)


def is_list_field(value: str) -> bool:
    """Whether ``value`` is a well-formed per-list token (``list:<uuid>``)."""
    if not value.startswith(LIST_FIELD_PREFIX):
        return False
    suffix = value[len(LIST_FIELD_PREFIX) :]
    try:
        UUID(suffix)
    except ValueError:
        return False
    return True


class SavedPresetFilters(SQLModel):
    selected_showtime_filter: Literal["all", "interested", "going"] | None = None
    showtime_audience: Literal["including-friends", "only-you"] = "including-friends"
    watchlist_only: bool = False
    watchlist_exclude: bool = False
    hide_watched: bool = False
    watched_only: bool = False
    selected_list_ids: list[str] | None = None
    exclude_list_ids: list[str] | None = None
    days: list[str] | None = None
    time_ranges: list[str] | None = None
    runtime_ranges: list[str] | None = None
    group_by_movie: bool | None = None

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


class SavedPresetCreate(SQLModel):
    name: str = Field(min_length=1, max_length=80)
    # Dimensions the preset leaves untouched on apply. Empty means "control
    # every dimension" (the default). Anything not listed here — including lists
    # added after the preset was saved — is controlled.
    untouched_fields: list[str] = Field(default_factory=list)
    filters: SavedPresetFilters
    cinema_ids: list[int] | None = None
    is_favorite: bool | None = None

    @field_validator("untouched_fields")
    @classmethod
    def validate_untouched_fields(cls, values: list[str]) -> list[str]:
        deduped = list(dict.fromkeys(values))
        if any(
            value not in UNTOUCHABLE_FIELDS and not is_list_field(value)
            for value in deduped
        ):
            raise ValueError(UNTOUCHED_FIELDS_VALIDATION_ERROR)
        return deduped

    @field_validator("cinema_ids")
    @classmethod
    def normalize_cinema_ids(cls, values: list[int] | None) -> list[int] | None:
        # Cinemas are opt-in: a preset touches them only when it carries a
        # selection. ``None`` means "leave the cinema selection as-is".
        if values is None:
            return None
        return sorted(set(values))


class SavedPresetPublic(SQLModel):
    id: UUID
    name: str
    is_favorite: bool
    untouched_fields: list[str]
    filters: SavedPresetFilters
    cinema_ids: list[int] | None
    created_at: datetime
    updated_at: datetime
