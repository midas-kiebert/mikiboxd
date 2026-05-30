"""Cinema models."""

from typing import TYPE_CHECKING

from sqlalchemy import Enum as SAEnum
from sqlmodel import Column, Field, Relationship, SQLModel

from app.validators.cinema_seating import CinemaSeatingPreset

if TYPE_CHECKING:
    from .city import City


class CinemaBase(SQLModel):
    name: str = Field(description="Name of the cinema")
    cineville: bool
    badge_bg_color: str
    url: str
    # Store the lowercase enum *value* ("free", "number-number", ...) rather than
    # the Python *name* ("FREE", "NUMBER_NUMBER", ...). SQLAlchemy's default Enum
    # mapping uses the name; values_callable overrides that to use the value, which
    # keeps the column human-readable and matches what cinemas.yaml writes.
    seating: CinemaSeatingPreset = Field(
        sa_column=Column(
            SAEnum(
                CinemaSeatingPreset,
                native_enum=False,
                length=40,
                values_callable=lambda enum: [m.value for m in enum],
            ),
            nullable=False,
        ),
        default=CinemaSeatingPreset.UNKNOWN,
    )


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
