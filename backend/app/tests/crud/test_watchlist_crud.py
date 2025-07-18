from uuid import uuid4

import pytest
from sqlmodel import Session, select

from app import crud
from app import exceptions as exc
from app.models import Movie, User, WatchlistSelection


def test_add_watchlist_selection_success(
    db_transaction: Session, user_factory, movie_factory
):
    user: User = user_factory()
    movie: Movie = movie_factory()

    crud.add_watchlist_selection(
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


def test_add_watchlist_selection_duplicate(
    db_transaction: Session,
    user_factory,
    movie_factory,
):
    user: User = user_factory()
    movie: Movie = movie_factory()

    # Add the selection once
    crud.add_watchlist_selection(
        session=db_transaction,
        user_id=user.id,
        movie_id=movie.id,
    )

    # Attempt to add the same selection again
    with pytest.raises(exc.WatchlistSelectionAlreadyExists):
        crud.add_watchlist_selection(
            session=db_transaction,
            user_id=user.id,
            movie_id=movie.id,
        )


def test_add_watchlist_selection_user_doesnt_exist(
    db_transaction: Session, movie_factory
):
    movie: Movie = movie_factory()

    # Attempt to add a selection for a non-existent user
    with pytest.raises(exc.WatchlistSelectionInvalid):
        crud.add_watchlist_selection(
            session=db_transaction,
            user_id=uuid4(),  # Invalid UUID
            movie_id=movie.id,
        )


def test_delete_watchlist_selection_success(
    db_transaction: Session, user_factory, movie_factory
):
    user: User = user_factory()
    movie: Movie = movie_factory()

    # First, add the selection
    crud.add_watchlist_selection(
        session=db_transaction,
        user_id=user.id,
        movie_id=movie.id,
    )

    # Now delete the selection
    crud.delete_watchlist_selection(
        session=db_transaction,
        user_id=user.id,
        movie_id=movie.id,
    )

    # Verify that the selection was deleted
    selection = db_transaction.exec(
        select(WatchlistSelection).where(
            (WatchlistSelection.user_id == user.id)
            & (WatchlistSelection.movie_id == movie.id)
        )
    ).first()

    assert selection is None


def test_delete_watchlist_selection_not_found(
    db_transaction: Session, user_factory, movie_factory
):
    user: User = user_factory()
    movie: Movie = movie_factory()

    # Attempt to delete a selection that doesn't exist
    with pytest.raises(exc.WatchlistSelectionNotFound):
        crud.delete_watchlist_selection(
            session=db_transaction,
            user_id=user.id,
            movie_id=movie.id,
        )
