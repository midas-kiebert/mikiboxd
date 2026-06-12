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
    assert movie.letterboxd_slug is not None

    before = watchlist_crud.does_watchlist_selection_exist(
        session=db_transaction,
        letterboxd_slug=movie.letterboxd_slug,
        letterboxd_username=user.letterboxd_username,
    )

    assert before is False

    added_selection = watchlist_crud.add_watchlist_selection(
        session=db_transaction,
        letterboxd_username=user.letterboxd_username,
        letterboxd_slug=movie.letterboxd_slug,
        movie_id=movie.id,
    )

    assert added_selection.movie_id == movie.id
    assert added_selection.letterboxd_slug == movie.letterboxd_slug

    after_add = watchlist_crud.does_watchlist_selection_exist(
        session=db_transaction,
        letterboxd_slug=movie.letterboxd_slug,
        letterboxd_username=user.letterboxd_username,
    )

    assert after_add is True

    deleted_selection = watchlist_crud.delete_watchlist_selection(
        session=db_transaction,
        letterboxd_username=user.letterboxd_username,
        letterboxd_slug=movie.letterboxd_slug,
    )

    assert deleted_selection.movie_id == movie.id

    after_delete = watchlist_crud.does_watchlist_selection_exist(
        session=db_transaction,
        letterboxd_slug=movie.letterboxd_slug,
        letterboxd_username=user.letterboxd_username,
    )

    assert after_delete is False

    db_transaction.flush()  # Raise Potential errors


def test_add_watchlist_selection_without_movie(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
):
    """Movies that aren't in our catalog are still stored, with movie_id unset."""
    user = user_factory()
    assert user.letterboxd_username is not None

    added_selection = watchlist_crud.add_watchlist_selection(
        session=db_transaction,
        letterboxd_username=user.letterboxd_username,
        letterboxd_slug="some-movie-not-in-our-catalog",
    )

    assert added_selection.movie_id is None
    assert added_selection.letterboxd_slug == "some-movie-not-in-our-catalog"

    db_transaction.flush()  # Raise Potential errors


def test_add_watchlist_selection_nonexistent_user(
    *, db_transaction: Session, movie_factory: Callable[..., Movie]
):
    movie = movie_factory()
    assert movie.letterboxd_slug is not None
    letterboxd_username = "nonexistent_user"

    # Test with nonexistent user
    with pytest.raises(IntegrityError) as exc_info:
        watchlist_crud.add_watchlist_selection(
            session=db_transaction,
            letterboxd_username=letterboxd_username,
            letterboxd_slug=movie.letterboxd_slug,
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
            letterboxd_slug="some-slug",
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
    assert movie.letterboxd_slug is not None

    # Add the watchlist selection for the first time
    added_selection = watchlist_crud.add_watchlist_selection(
        session=db_transaction,
        letterboxd_username=user.letterboxd_username,
        letterboxd_slug=movie.letterboxd_slug,
        movie_id=movie.id,
    )
    assert added_selection.movie_id == movie.id

    # Attempt to add the same selection again
    with pytest.raises(IntegrityError) as exc_info:
        watchlist_crud.add_watchlist_selection(
            session=db_transaction,
            letterboxd_username=user.letterboxd_username,
            letterboxd_slug=movie.letterboxd_slug,
            movie_id=movie.id,
        )

    assert isinstance(exc_info.value.orig, UniqueViolation)


def test_delete_watchlist_selection_nonexistent_user(
    *, db_transaction: Session, movie_factory: Callable[..., Movie]
):
    movie = movie_factory()
    assert movie.letterboxd_slug is not None

    letterboxd_username = "nonexistent_user"

    with pytest.raises(NoResultFound):
        watchlist_crud.delete_watchlist_selection(
            session=db_transaction,
            letterboxd_username=letterboxd_username,
            letterboxd_slug=movie.letterboxd_slug,
        )


def test_delete_watchlist_selection_nonexistent_movie(
    *, db_transaction: Session, user_factory: Callable[..., User]
):
    user = user_factory()
    assert user.letterboxd_username is not None
    # Test with nonexistent slug
    with pytest.raises(NoResultFound):
        watchlist_crud.delete_watchlist_selection(
            session=db_transaction,
            letterboxd_username=user.letterboxd_username,
            letterboxd_slug="some-slug",
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
    assert movie1.letterboxd_slug is not None
    assert movie2.letterboxd_slug is not None

    # Add two watchlist selections
    watchlist_crud.add_watchlist_selection(
        session=db_transaction,
        letterboxd_username=user.letterboxd_username,
        letterboxd_slug=movie1.letterboxd_slug,
        movie_id=movie1.id,
    )
    watchlist_crud.add_watchlist_selection(
        session=db_transaction,
        letterboxd_username=user.letterboxd_username,
        letterboxd_slug=movie2.letterboxd_slug,
        movie_id=movie2.id,
    )

    selections = watchlist_crud.get_watchlist_selections(
        session=db_transaction,
        letterboxd_username=user.letterboxd_username,
    )

    selection1 = WatchlistSelection(
        letterboxd_username=user.letterboxd_username,
        letterboxd_slug=movie1.letterboxd_slug,
        movie_id=movie1.id,
    )
    selection2 = WatchlistSelection(
        letterboxd_username=user.letterboxd_username,
        letterboxd_slug=movie2.letterboxd_slug,
        movie_id=movie2.id,
    )

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
    assert movie1.letterboxd_slug is not None
    assert movie2.letterboxd_slug is not None

    # Add two watchlist selections
    watchlist_crud.add_watchlist_selection(
        session=db_transaction,
        letterboxd_username=user.letterboxd_username,
        letterboxd_slug=movie1.letterboxd_slug,
        movie_id=movie1.id,
    )
    watchlist_crud.add_watchlist_selection(
        session=db_transaction,
        letterboxd_username=user.letterboxd_username,
        letterboxd_slug=movie2.letterboxd_slug,
        movie_id=movie2.id,
    )

    watchlist = watchlist_crud.get_watchlist(
        session=db_transaction, letterboxd_username=user.letterboxd_username
    )

    assert movie1 in watchlist
    assert movie2 in watchlist
    assert len(watchlist) == 2


def test_get_watchlist_excludes_selections_without_movie(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    movie_factory: Callable[..., Movie],
):
    user = user_factory()
    movie = movie_factory()

    assert user.letterboxd_username is not None
    assert movie.letterboxd_slug is not None

    watchlist_crud.add_watchlist_selection(
        session=db_transaction,
        letterboxd_username=user.letterboxd_username,
        letterboxd_slug=movie.letterboxd_slug,
        movie_id=movie.id,
    )
    watchlist_crud.add_watchlist_selection(
        session=db_transaction,
        letterboxd_username=user.letterboxd_username,
        letterboxd_slug="not-in-our-catalog",
    )

    watchlist = watchlist_crud.get_watchlist(
        session=db_transaction, letterboxd_username=user.letterboxd_username
    )

    assert watchlist == [movie]
