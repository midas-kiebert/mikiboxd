from datetime import datetime
from uuid import UUID

from pydantic import field_validator
from sqlmodel import Field, SQLModel

__all__ = [
    "CinemaPresetCreate",
    "CinemaPresetPublic",
]


class CinemaPresetCreate(SQLModel):
    name: str = Field(min_length=1, max_length=80)
    cinema_ids: list[int] = Field(default_factory=list)
    is_favorite: bool | None = None

    @field_validator("cinema_ids")
    @classmethod
    def normalize_cinema_ids(cls, cinema_ids: list[int]) -> list[int]:
        return sorted(set(cinema_ids))


class CinemaPresetPublic(SQLModel):
    id: UUID
    name: str
    is_default: bool
    cinema_ids: list[int]
    is_favorite: bool
    created_at: datetime
    updated_at: datetime
