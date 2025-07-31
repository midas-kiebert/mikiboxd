from typing import TYPE_CHECKING

from app.models.city import CityBase

if TYPE_CHECKING:
    pass

__all__ = [
    "CityPublic",
]


class CityPublic(CityBase):
    pass
