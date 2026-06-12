from datetime import datetime
from uuid import UUID

from pydantic import field_validator, model_validator
from sqlmodel import Field, SQLModel

from app.core.enums import FilterPresetScope
from app.schemas.filter_preset import FilterPresetFilters

__all__ = [
    "INCLUDABLE_FIELDS",
    "CINEMAS_FIELD",
    "SavedPresetCreate",
    "SavedPresetPublic",
]

# Token used in ``included_fields`` to mark that the preset carries a cinema
# selection (stored in ``cinema_ids`` rather than in ``filters``).
CINEMAS_FIELD = "cinemas"

# The dimensions a saved preset may apply. The filter-shaped tokens map 1:1 to
# fields on :class:`FilterPresetFilters`; ``cinemas`` maps to ``cinema_ids``.
INCLUDABLE_FIELDS = frozenset(
    {
        "selected_showtime_filter",
        "showtime_audience",
        "watchlist_only",
        "hide_watched",
        "days",
        "time_ranges",
        "runtime_ranges",
        "group_by_movie",
        CINEMAS_FIELD,
    }
)

INCLUDED_FIELDS_VALIDATION_ERROR = (
    "included_fields must be a non-empty subset of: "
    + ", ".join(sorted(INCLUDABLE_FIELDS))
)


class SavedPresetCreate(SQLModel):
    name: str = Field(min_length=1, max_length=80)
    scope: FilterPresetScope
    included_fields: list[str]
    filters: FilterPresetFilters
    cinema_ids: list[int] | None = None
    is_favorite: bool | None = None

    @field_validator("included_fields")
    @classmethod
    def validate_included_fields(cls, values: list[str]) -> list[str]:
        deduped = list(dict.fromkeys(values))
        if not deduped or any(value not in INCLUDABLE_FIELDS for value in deduped):
            raise ValueError(INCLUDED_FIELDS_VALIDATION_ERROR)
        return deduped

    @model_validator(mode="after")
    def reconcile_cinema_ids(self) -> "SavedPresetCreate":
        if CINEMAS_FIELD in self.included_fields:
            if self.cinema_ids is None:
                raise ValueError(
                    'cinema_ids is required when "cinemas" is in included_fields'
                )
            self.cinema_ids = sorted(set(self.cinema_ids))
        else:
            # Cinema not part of this preset — never persist a stray selection.
            self.cinema_ids = None
        return self


class SavedPresetPublic(SQLModel):
    id: UUID
    name: str
    scope: FilterPresetScope
    is_favorite: bool
    included_fields: list[str]
    filters: FilterPresetFilters
    cinema_ids: list[int] | None
    created_at: datetime
    updated_at: datetime
