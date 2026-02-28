from typing import TYPE_CHECKING

from pydantic import field_validator
from sqlmodel import Field, Relationship, SQLModel

from app.core.cinema_seating import (
    DEFAULT_CINEMA_SEATING_PRESET,
    normalize_cinema_seating_preset,
)

if TYPE_CHECKING:
    from .city import City

__all__ = [
    "CinemaBase",
    "CinemaCreate",
    "Cinema",
]


class CinemaBase(SQLModel):
    name: str = Field(description="Name of the cinema")
    cineville: bool
    badge_bg_color: str
    url: str
    seating: str = Field(default=DEFAULT_CINEMA_SEATING_PRESET, max_length=40)

    @field_validator("seating", mode="before")
    @classmethod
    def validate_seating(cls, value: str | None) -> str:
        return normalize_cinema_seating_preset(value)


class CinemaCreate(CinemaBase):
    city_id: int = Field(description="ID of the city where the cinema is located")


class Cinema(CinemaBase, table=True):
    id: int = Field(
        primary_key=True,
        unique=True,
        index=True,
    )
    city_id: int = Field(foreign_key="city.id")
    city: "City" = Relationship(sa_relationship_kwargs={"lazy": "joined"})
