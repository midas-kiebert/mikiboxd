from sqlmodel import Session

from app.models.cinema import Cinema
from app.models.showtime import Showtime
from app.schemas.cinema import CinemaPublic, FestivalPublic


def to_public(cinema: Cinema) -> CinemaPublic:
    return CinemaPublic.model_validate(cinema)


def festival_to_public(
    *, session: Session, showtime: Showtime
) -> FestivalPublic | None:
    """The festival badge for a showtime, if it is part of one.

    `session.get` serves a page of screenings from one festival out of the
    identity map after the first, so this is one query per festival, not per row.
    """
    if showtime.festival_id is None:
        return None
    festival = session.get(Cinema, showtime.festival_id)
    if festival is None:
        return None
    return FestivalPublic.model_validate(festival)


def cineville_pass(showtime: Showtime) -> bool:
    """Whether the pass covers this screening: the festival's say, else the cinema's."""
    if showtime.cineville_pass is not None:
        return showtime.cineville_pass
    return showtime.cinema.cineville
