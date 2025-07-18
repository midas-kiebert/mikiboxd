from uuid import UUID

from psycopg.errors import (
    ForeignKeyViolation,
    UniqueViolation,
)
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, select

from app import exceptions as exc
from app.models import Movie, WatchlistSelection

__all__ = [
    "add_watchlist_selection",
    "delete_watchlist_selection",
    "clear_watchlist",
    "update_watchlist",
    "get_watchlist",
]


def add_watchlist_selection(*, session: Session, user_id: UUID, movie_id: int) -> None:
    """
    Add a selection for a showtime by a user.
    """
    selection = WatchlistSelection(user_id=user_id, movie_id=movie_id)
    session.add(selection)
    try:
        session.commit()
        session.refresh(selection)
    except IntegrityError as e:
        session.rollback()

        if isinstance(e.orig, UniqueViolation):
            raise exc.WatchlistSelectionAlreadyExists()
        elif isinstance(e.orig, ForeignKeyViolation):
            raise exc.WatchlistSelectionInvalid()
        raise exc.WatchlistError()


def delete_watchlist_selection(
    *, session: Session, user_id: UUID, movie_id: int
) -> None:
    """
    Delete a selection for a showtime by a user.
    """
    selection = session.exec(
        select(WatchlistSelection).where(
            (WatchlistSelection.user_id == user_id)
            & (WatchlistSelection.movie_id == movie_id)
        )
    ).first()
    if not selection:
        raise exc.WatchlistSelectionNotFound()

    session.delete(selection)

    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise exc.WatchlistError()


def clear_watchlist(*, session: Session, user_id: UUID) -> None:
    """
    Clear all watchlist selections for a user.
    """
    selections = session.exec(
        select(WatchlistSelection).where(WatchlistSelection.user_id == user_id)
    ).all()

    for selection in selections:
        session.delete(selection)

    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise exc.WatchlistError()


def update_watchlist(
    *,
    session: Session,
    user_id: UUID,
    watchlist_slugs: list[str],
):
    """
    Clear and update the watchlist for a user based on a list of movie slugs.
    """
    clear_watchlist(
        session=session,
        user_id=user_id,
    )
    for slug in watchlist_slugs:
        movie = session.exec(select(Movie).where(Movie.letterboxd_slug == slug)).first()
        if not movie:
            raise exc.MovieNotFound()

        add_watchlist_selection(
            session=session,
            user_id=user_id,
            movie_id=movie.id,
        )

    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise exc.WatchlistError()


def get_watchlist(*, session: Session, user_id: UUID) -> list[Movie]:
    """
    Get all watchlist selections for a user.
    """
    selections = session.exec(
        select(WatchlistSelection).where(WatchlistSelection.user_id == user_id)
    ).all()

    if not selections:
        return []

    movie_ids = [selection.movie_id for selection in selections]
    movies = session.exec(select(Movie).where(col(Movie.id).in_(movie_ids))).all()

    return list(movies)
