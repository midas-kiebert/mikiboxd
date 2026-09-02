from datetime import datetime
from uuid import UUID

from pydantic import field_validator
from sqlmodel import Field, SQLModel

from app.schemas.cinema_scope import CinemaScope

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
    """Editing an existing preset: its name, and optionally its cinemas.

    ``cinema_ids`` is optional so a plain rename (the manage-presets page's
    inline text edit) never has to resend the selection — omitted means
    "leave the cinemas as they are"; an empty list is a real (if unusual)
    "no cinemas" selection, not "don't touch this".
    """

    name: str = Field(min_length=1, max_length=80)
    cinema_ids: list[int] | None = Field(default=None)

    @field_validator("cinema_ids")
    @classmethod
    def normalize_cinema_ids(cls, cinema_ids: list[int] | None) -> list[int] | None:
        if cinema_ids is None:
            return None
        return sorted(set(cinema_ids))


class CinemaPresetPublic(SQLModel):
    id: UUID
    name: str
    is_default: bool
    # The selection as it stands today: the preset's rule expanded against the
    # current cinema list, so a client that knows nothing about scopes still
    # gets the cinema that opened last month.
    cinema_ids: list[int]
    # The rule behind it, for clients that want to say "All Amsterdam cinemas"
    # rather than "5 cinemas". Additive: older builds ignore it.
    cinema_scope: CinemaScope | None = None
    is_favorite: bool
    created_at: datetime
    updated_at: datetime
