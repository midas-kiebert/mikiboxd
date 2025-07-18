from sqlmodel import Session, select

from app.crud.watchlist import (
    WatchlistSelection,
    add_watchlist_selection,
)
from app.models import Movie, User


def test_add_watchlist_selection_success(
    db_transaction: Session, user_factory, movie_factory
):
    user: User = user_factory()
    movie: Movie = movie_factory()

    add_watchlist_selection(
        session=db_transaction,
        user_id=user.id,
        movie_id=movie.id,
    )

    # Verify that the selection was added
    selection = db_transaction.exec(
        select(WatchlistSelection).where(
            (WatchlistSelection.user_id == user.id)
            & (WatchlistSelection.movie_id == movie.id)
        )
    ).first()

    assert selection is not None
    assert selection.user_id == user.id
    assert selection.movie_id == movie.id
