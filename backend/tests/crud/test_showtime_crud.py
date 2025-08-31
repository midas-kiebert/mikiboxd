from collections.abc import Callable

import pytest
from psycopg.errors import ForeignKeyViolation, UniqueViolation
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session

from app.crud import friendship as friendship_crud
from app.crud import showtime as showtime_crud
from app.crud import user as user_crud
from app.models.cinema import Cinema
from app.models.movie import Movie
from app.models.showtime import Showtime, ShowtimeCreate
from app.models.user import User


def test_get_showtime_by_id_success(*, db_transaction: Session, showtime_factory):
    showtime: Showtime = showtime_factory()

    retrieved_showtime = showtime_crud.get_showtime_by_id(
        session=db_transaction,
        showtime_id=showtime.id,
    )

    # Check if the returned object matches the one in the database
    assert retrieved_showtime is showtime


def test_get_showtime_by_id_not_found(
    *,
    db_transaction: Session,
):
    retrieved_showtime = showtime_crud.get_showtime_by_id(
        session=db_transaction,
        showtime_id=1,  # Assuming this ID does not exist
    )

    # Check if the returned object is None when the showtime does not exist
    assert retrieved_showtime is None


def test_create_showtime_success(
    *,
    db_transaction: Session,
    showtime_create_factory,
    movie_factory,
    cinema_factory,
):
    movie: Movie = movie_factory()
    cinema: Cinema = cinema_factory()
    showtime_create: ShowtimeCreate = showtime_create_factory(
        movie_id=movie.id,
        cinema_id=cinema.id,  # Assuming cinema_id is optional for this test
    )

    created_showtime = showtime_crud.create_showtime(
        session=db_transaction,
        showtime_create=showtime_create,
    )

    # Check if the returned object is correct
    assert created_showtime.id is not None
    assert created_showtime.cinema_id == showtime_create.cinema_id
    assert created_showtime.movie_id == showtime_create.movie_id
    assert created_showtime.datetime == showtime_create.datetime

    inserted_showtime = db_transaction.get(Showtime, created_showtime.id)

    assert inserted_showtime is created_showtime


def test_create_showtime_already_exists(
    *,
    db_transaction: Session,
    showtime_create_factory,
    showtime_factory,
):
    existing_showtime: Showtime = showtime_factory()
    showtime_create: ShowtimeCreate = showtime_create_factory(
        datetime=existing_showtime.datetime,
        movie_id=existing_showtime.movie_id,
        cinema_id=existing_showtime.cinema_id,
    )

    with pytest.raises(IntegrityError) as exc_info:
        showtime_crud.create_showtime(
            session=db_transaction,
            showtime_create=showtime_create,
        )

    # Check if the error is a UniqueViolation
    assert isinstance(exc_info.value.orig, UniqueViolation)


def test_create_showtime_invalid_movie(
    *, db_transaction: Session, showtime_create_factory, cinema_factory
):
    cinema: Cinema = cinema_factory()
    showtime_create: ShowtimeCreate = showtime_create_factory(
        cinema_id=cinema.id, movie_id=1
    )

    with pytest.raises(IntegrityError) as exc_info:
        showtime_crud.create_showtime(
            session=db_transaction,
            showtime_create=showtime_create,
        )

    # Check if the error is a ForeignKeyViolation
    assert isinstance(exc_info.value.orig, ForeignKeyViolation)


def test_create_showtime_invalid_cinema(
    *, db_transaction: Session, showtime_create_factory, movie_factory
):
    movie: Movie = movie_factory()
    showtime_create: ShowtimeCreate = showtime_create_factory(
        movie_id=movie.id, cinema_id=1
    )

    with pytest.raises(IntegrityError) as exc_info:
        showtime_crud.create_showtime(
            session=db_transaction,
            showtime_create=showtime_create,
        )

    # Check if the error is a ForeignKeyViolation
    assert isinstance(exc_info.value.orig, ForeignKeyViolation)


def test_get_friends_for_showtime(
    *,
    db_transaction: Session,
    showtime_factory: Callable[..., Showtime],
    user_factory: Callable[..., User],
):
    user = user_factory()
    friend_1 = user_factory()
    friend_2 = user_factory()
    user_3 = user_factory()
    showtime = showtime_factory()

    # Create friendships
    friendship_crud.create_friendship(
        session=db_transaction, user_id=user.id, friend_id=friend_1.id
    )
    friendship_crud.create_friendship(
        session=db_transaction, user_id=user.id, friend_id=friend_2.id
    )

    user_crud.add_showtime_selection(
        session=db_transaction, user_id=user.id, showtime_id=showtime.id
    )
    user_crud.add_showtime_selection(
        session=db_transaction, user_id=friend_1.id, showtime_id=showtime.id
    )
    user_crud.add_showtime_selection(
        session=db_transaction, user_id=user_3.id, showtime_id=showtime.id
    )

    friends = showtime_crud.get_friends_for_showtime(
        session=db_transaction,
        showtime_id=showtime.id,
        user_id=user.id,
    )

    # Check if the returned list contains the friend
    assert friend_1 in friends
    assert len(friends) == 1
