from sqlmodel import Session, col, select

from app.converters import cinema as cinema_converter
from app.core.enums import CinemaKind
from app.crud import cinema as cinema_crud
from app.models.showtime import Showtime
from app.schemas.cinema import CinemaPublic
from app.utils import now_amsterdam_naive


def _ids_with_upcoming_screenings(session: Session) -> set[int]:
    """Cinemas a screening from now on plays at or belongs to (a festival)."""
    rows = session.exec(
        select(Showtime.cinema_id, Showtime.festival_id)
        .where(col(Showtime.datetime) >= now_amsterdam_naive())
        .distinct()
    ).all()
    return {cinema_id for row in rows for cinema_id in row if cinema_id is not None}


def get_all_cinemas(session: Session) -> list[CinemaPublic]:
    """Every cinema, and the festivals and festival venues that are on.

    A festival or a venue that only shows films during one is a pickable
    "cinema" only while it has something coming up: outside its dates it is
    an empty entry in every picker.
    """
    db_cinemas = cinema_crud.get_cinemas(session=session)
    active_ids: set[int] | None = None
    visible = []
    for cinema in db_cinemas:
        if cinema.kind != CinemaKind.CINEMA:
            if active_ids is None:
                active_ids = _ids_with_upcoming_screenings(session)
            if cinema.id not in active_ids:
                continue
        visible.append(cinema)
    return [cinema_converter.to_public(cinema) for cinema in visible]
