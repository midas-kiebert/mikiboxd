from app.models.city import City
from app.schemas.city import CityPublic


def to_public(cinema: City) -> CityPublic:
    return CityPublic.model_validate(cinema)
