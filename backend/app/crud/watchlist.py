from app.models import WatchlistSelection
from sqlmodel import Session, select
from sqlalchemy.exc import IntegrityError
from uuid import UUID


def add_showtime_selection(
    *,
    session: Session,
    user_id: UUID,
    movie_id: int
) -> None:
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


def delete_showtime_selection(
    *,
    session: Session,
    user_id: UUID,
    movie_id: int
) -> None:
    """
    Delete a selection for a showtime by a user.
    """
    selection = session.exec(
        select(WatchlistSelection).where(
            (WatchlistSelection.user_id == user_id) & (WatchlistSelection.movie_id == movie_id)
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
