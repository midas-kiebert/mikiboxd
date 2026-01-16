from typing import TYPE_CHECKING

from app.models.cinema import CinemaBase

if TYPE_CHECKING:
    from .city import CityPublic

__all__ = [
    "CinemaPublic",
]


class CinemaPublic(CinemaBase):
    id: int
    city: "CityPublic"
    test: int = 32
