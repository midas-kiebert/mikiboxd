from datetime import datetime
from uuid import UUID

from pydantic import field_validator
from sqlmodel import Field, SQLModel

__all__ = [
    "CinemaPresetCreate",
    "CinemaPresetPublic",
    "CinemaPresetRename",
]


class CinemaPresetCreate(SQLModel):
    name: str = Field(min_length=1, max_length=80)
    cinema_ids: list[int] = Field(default_factory=list)
    is_favorite: bool | None = None
    # Reusing a name replaces that preset instead of 409-ing. Off by default so
    # a clash is reported to the user, who then decides; older clients that
    # predate the flag simply never opt in.
    overwrite: bool = False

    @field_validator("cinema_ids")
    @classmethod
    def normalize_cinema_ids(cls, cinema_ids: list[int]) -> list[int]:
        return sorted(set(cinema_ids))


class CinemaPresetRename(SQLModel):
    """The only field of a saved preset the user can edit after the fact.

    Its cinemas are changed by re-picking them in the sheet and saving over the
    preset, so a rename never carries a selection with it.
    """

    name: str = Field(min_length=1, max_length=80)


class CinemaPresetPublic(SQLModel):
    id: UUID
    name: str
    is_default: bool
    cinema_ids: list[int]
    is_favorite: bool
    created_at: datetime
    updated_at: datetime
