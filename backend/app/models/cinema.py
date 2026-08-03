"""Cinema models."""

from typing import TYPE_CHECKING

from sqlalchemy import Enum as SAEnum
from sqlalchemy import String
from sqlalchemy.dialects.postgresql import ARRAY
from sqlmodel import Column, Field, Relationship, SQLModel

from app.validators.cinema_seating import CinemaSeatingPreset

if TYPE_CHECKING:
    from .city import City

CINEMA_KEY_DESCRIPTION = (
    "Stable identifier from cinemas.yaml. Never changes and is never shown; "
    "seeding and scrapers resolve a cinema by this, not by its name."
)
CINEMA_ALIASES_DESCRIPTION = (
    "Other names this cinema is known by (Cineville venue names, former display "
    "names). Matched when ingesting showtimes and when searching by cinema."
)


class CinemaBase(SQLModel):
    """The cinema fields that are served to clients.

    Deliberately excludes `key` and `aliases`: those are how the backend
    identifies and matches a cinema, and no client has any use for them.
    """

    name: str = Field(description="Display name of the cinema, shown to users")
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
    key: str = Field(description=CINEMA_KEY_DESCRIPTION)
    aliases: list[str] = Field(
        default_factory=list,
        description=CINEMA_ALIASES_DESCRIPTION,
    )
    city_id: int = Field(description="ID of the city where the cinema is located")


class Cinema(CinemaBase, table=True):
    id: int = Field(
        primary_key=True,
        unique=True,
        index=True,
    )
    key: str = Field(
        description=CINEMA_KEY_DESCRIPTION,
        index=True,
        unique=True,
    )
    aliases: list[str] = Field(
        sa_column=Column(ARRAY(String), nullable=False, server_default="{}"),
        default_factory=list,
        description=CINEMA_ALIASES_DESCRIPTION,
    )
    city_id: int = Field(foreign_key="city.id")
    city: "City" = Relationship(sa_relationship_kwargs={"lazy": "joined"})
