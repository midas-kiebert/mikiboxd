from app.models.cinema import Cinema
from app.schemas.cinema import CinemaPublic


def to_public(cinema: Cinema) -> CinemaPublic:
    return CinemaPublic.model_validate(cinema)
