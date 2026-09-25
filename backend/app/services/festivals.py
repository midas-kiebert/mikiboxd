"""Placing festival screenings at their real location.

Cineville lists a festival as one venue ("LIFF"), so its events arrive with no
hall. A festival with its own scraper (app/scraping/festivals/) knows the hall,
and these helpers let the two sources land on the same row:

- `resolve_cineville_festival_cinema` — a Cineville festival event finds the
  scraper's screening at the same time and takes its cinema.
- `adopt_placeholder_showtime` — the other order: Cineville got there first and
  put the screening at the festival itself; the scraper moves that row to the
  real cinema instead of adding a second one, so selections on it survive.
"""

from datetime import datetime

from sqlmodel import Session, col, select

from app.models.movie import Movie
from app.models.showtime import Showtime, ShowtimeCreate
from app.services.showtime_title_conflict import titles_conflict_match


def resolve_cineville_festival_cinema(
    *,
    session: Session,
    festival_id: int,
    start: datetime,
    movie_id: int,
    movie_title: str,
) -> int | None:
    """The real cinema of a Cineville festival event, if a scraper listed it.

    Matched on the exact start time within the festival, then on the film: the
    same TMDB id, or failing that a near-identical title (the two sources can
    resolve a double bill or a festival retitling to different films).
    """
    rows = session.exec(
        select(Showtime.cinema_id, Showtime.movie_id, Movie.title)
        .join(Movie, col(Movie.id) == col(Showtime.movie_id))
        .where(
            Showtime.festival_id == festival_id,
            Showtime.datetime == start,
            Showtime.cinema_id != festival_id,
        )
    ).all()
    for cinema_id, candidate_movie_id, _ in rows:
        if candidate_movie_id == movie_id:
            return cinema_id
    for cinema_id, _, candidate_title in rows:
        if titles_conflict_match(movie_title, candidate_title):
            return cinema_id
    return None


def adopt_placeholder_showtime(
    *,
    session: Session,
    showtime_create: ShowtimeCreate,
) -> None:
    """Move a screening Cineville placed at the festival to its real cinema.

    Does nothing when there is no such row, or when the real cinema already has
    the screening (then the placeholder loses its Cineville presence on the next
    Cineville run, which now resolves to the real cinema, and is cleaned up).
    """
    festival_id = showtime_create.festival_id
    if festival_id is None or showtime_create.cinema_id == festival_id:
        return
    placeholder = session.exec(
        select(Showtime).where(
            Showtime.cinema_id == festival_id,
            Showtime.datetime == showtime_create.datetime,
            Showtime.movie_id == showtime_create.movie_id,
        )
    ).first()
    if placeholder is None:
        return
    already_there = session.exec(
        select(Showtime.id).where(
            Showtime.cinema_id == showtime_create.cinema_id,
            Showtime.datetime == showtime_create.datetime,
            Showtime.movie_id == showtime_create.movie_id,
        )
    ).first()
    if already_there is not None:
        return
    placeholder.cinema_id = showtime_create.cinema_id
    # A room named at the festival (the location, when it was unknown) says
    # nothing about the real cinema's halls.
    placeholder.room = None
    placeholder.room_key = None
    session.flush()
