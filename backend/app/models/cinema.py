"""Cinema models."""

from typing import TYPE_CHECKING

from sqlmodel import Field, Relationship, SQLModel

from app.validators.cinema_seating import CinemaSeatingPreset

if TYPE_CHECKING:
    from .city import City


class CinemaBase(SQLModel):
    name: str = Field(description="Name of the cinema")
    cineville: bool
    badge_bg_color: str
    url: str
    # Pydantic coerces plain strings (e.g. "letter-number") to the enum automatically,
    # so no manual validator is needed. Preset values are defined in CinemaSeatingPreset.
    seating: CinemaSeatingPreset = Field(default=CinemaSeatingPreset.UNKNOWN)


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
