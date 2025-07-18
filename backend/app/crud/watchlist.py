from uuid import UUID

from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

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
    except IntegrityError:
        session.rollback()
        raise ValueError("Selection already exists or invalid data.")


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
        raise ValueError("Selection does not exist.")

    session.delete(selection)

    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise ValueError("Failed to delete selection.")
