from collections.abc import Callable

import pytest
from psycopg.errors import ForeignKeyViolation, UniqueViolation
from sqlalchemy.exc import IntegrityError, NoResultFound
from sqlmodel import Session

from app.crud import watchlist as watchlist_crud
from app.models.movie import Movie
from app.models.user import User
from app.models.watchlist_selection import WatchlistSelection


def test_add_delete_watchlist_selection(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    movie_factory: Callable[..., Movie],
):
    user = user_factory()
    movie = movie_factory()

    assert user.letterboxd_username is not None

    before = watchlist_crud.does_watchlist_selection_exist(
        session=db_transaction, movie_id=movie.id, letterboxd_username=user.letterboxd_username)

    assert before is False

    added_movie = watchlist_crud.add_watchlist_selection(
        session=db_transaction, letterboxd_username=user.letterboxd_username, movie_id=movie.id
    )

    assert added_movie is movie

    after_add = watchlist_crud.does_watchlist_selection_exist(
        session=db_transaction, movie_id=movie.id, letterboxd_username=user.letterboxd_username
    )

    assert after_add is True

    deleted_movie = watchlist_crud.delete_watchlist_selection(
        session=db_transaction, letterboxd_username=user.letterboxd_username, movie_id=movie.id
    )

    assert deleted_movie is movie

    after_delete = watchlist_crud.does_watchlist_selection_exist(
        session=db_transaction, movie_id=movie.id, letterboxd_username=user.letterboxd_username
    )

    assert after_delete is False

    db_transaction.flush()  # Raise Potential errors


def test_add_watchlist_selection_nonexistent_user(
    *, db_transaction: Session, movie_factory: Callable[..., Movie]
):
    movie = movie_factory()
    letterboxd_username = "nonexistent_user"

    # Test with nonexistent user
    with pytest.raises(IntegrityError) as exc_info:
        watchlist_crud.add_watchlist_selection(
            session=db_transaction,
            letterboxd_username=letterboxd_username,
            movie_id=movie.id,
        )

    assert isinstance(exc_info.value.orig, ForeignKeyViolation)


def test_add_watchlist_selection_nonexistent_movie(
    *, db_transaction: Session, user_factory: Callable[..., User]
):
    user = user_factory()
    assert user.letterboxd_username is not None

    # Test with nonexistent movie
    with pytest.raises(IntegrityError) as exc_info:
        watchlist_crud.add_watchlist_selection(
            session=db_transaction,
            letterboxd_username=user.letterboxd_username,
            movie_id=99999,  # Nonexistent movie ID
        )

    assert isinstance(exc_info.value.orig, ForeignKeyViolation)


def test_add_watchlist_selection_duplicate_selection(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    movie_factory: Callable[..., Movie],
):
    user = user_factory()
    movie = movie_factory()

    assert user.letterboxd_username is not None

    # Add the watchlist selection for the first time
    added_movie = watchlist_crud.add_watchlist_selection(
        session=db_transaction, letterboxd_username=user.letterboxd_username, movie_id=movie.id
    )
    assert added_movie is movie

    # Attempt to add the same selection again
    with pytest.raises(IntegrityError) as exc_info:
        watchlist_crud.add_watchlist_selection(
            session=db_transaction, letterboxd_username=user.letterboxd_username, movie_id=movie.id
        )

    assert isinstance(exc_info.value.orig, UniqueViolation)


def test_delete_watchlist_selection_nonexistent_user(
    *, db_transaction: Session, movie_factory: Callable[..., Movie]
):
    movie = movie_factory()

    letterboxd_username = "nonexistent_user"

    with pytest.raises(NoResultFound):
        watchlist_crud.delete_watchlist_selection(
            session=db_transaction, letterboxd_username=letterboxd_username, movie_id=movie.id
        )


def test_delete_watchlist_selection_nonexistent_movie(
    *, db_transaction: Session, user_factory: Callable[..., User]
):
    user = user_factory()
    assert user.letterboxd_username is not None
    # Test with nonexistent movie
    with pytest.raises(NoResultFound):
        watchlist_crud.delete_watchlist_selection(
            session=db_transaction, letterboxd_username=user.letterboxd_username, movie_id=999999
        )


def test_get_watchlist_selections(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    movie_factory: Callable[..., Movie],
):
    user = user_factory()
    movie1 = movie_factory()
    movie2 = movie_factory()
    movie_factory()

    assert user.letterboxd_username is not None

    # Add two watchlist selections
    watchlist_crud.add_watchlist_selection(
        session=db_transaction,
        letterboxd_username=user.letterboxd_username,
        movie_id=movie1.id
    )
    watchlist_crud.add_watchlist_selection(
        session=db_transaction,
        letterboxd_username=user.letterboxd_username,
        movie_id=movie2.id
    )

    selections = watchlist_crud.get_watchlist_selections(
        session=db_transaction,
        letterboxd_username=user.letterboxd_username,
    )

    selection1 = WatchlistSelection(letterboxd_username=user.letterboxd_username, movie_id=movie1.id)
    selection2 = WatchlistSelection(letterboxd_username=user.letterboxd_username, movie_id=movie2.id)

    assert selection1 in selections
    assert selection2 in selections
    assert len(selections) == 2


def test_get_watchlist(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    movie_factory: Callable[..., Movie],
):
    user = user_factory()
    movie1 = movie_factory()
    movie2 = movie_factory()
    movie_factory()

    assert user.letterboxd_username is not None

    # Add two watchlist selections
    watchlist_crud.add_watchlist_selection(
        session=db_transaction, letterboxd_username=user.letterboxd_username, movie_id=movie1.id
    )
    watchlist_crud.add_watchlist_selection(
        session=db_transaction, letterboxd_username=user.letterboxd_username, movie_id=movie2.id
    )

    watchlist = watchlist_crud.get_watchlist(session=db_transaction, letterboxd_username=user.letterboxd_username)

    assert movie1 in watchlist
    assert movie2 in watchlist
    assert len(watchlist) == 2
