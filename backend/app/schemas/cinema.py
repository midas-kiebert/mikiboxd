from typing import TYPE_CHECKING

from sqlmodel import Field

from app.models.cinema import CINEMA_ALIASES_DESCRIPTION, CinemaBase

if TYPE_CHECKING:
    from .city import CityPublic

__all__ = [
    "CinemaPublic",
]


class CinemaPublic(CinemaBase):
    id: int
    city: "CityPublic"
    # Served so a picker filtering the cinema list in the client finds a venue
    # under every name the server's search-by-cinema does (`_matching_cinema_ids_subquery`).
    # Additive and defaulted, so builds that predate it just ignore it.
    aliases: list[str] = Field(
        default_factory=list, description=CINEMA_ALIASES_DESCRIPTION
    )
