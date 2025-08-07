from sqlmodel import Session

from app.converters import cinema as cinema_converter
from app.crud import cinema as cinema_crud
from app.schemas.cinema import CinemaPublic


def get_all_cinemas(session: Session) -> list[CinemaPublic]:
    db_cinemas = cinema_crud.get_cinemas(session=session)
    return [cinema_converter.to_public(cinema) for cinema in db_cinemas]
