from uuid import UUID

from psycopg.errors import (
    ForeignKeyViolation,
    UniqueViolation,
)
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app import exceptions as exc
from app.models import WatchlistSelection

__all__ = [
    "add_watchlist_selection",
    "delete_watchlist_selection",
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
        raise exc.WatchlistSelectionError()


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
        raise exc.WatchlistSelectionError()
