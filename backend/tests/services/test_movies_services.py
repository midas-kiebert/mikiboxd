from random import randint

import pytest
from psycopg.errors import UniqueViolation
from pytest_mock import MockerFixture
from sqlalchemy.exc import IntegrityError

from app.exceptions.movie_exceptions import (
    MovieNotFoundError,
)
from app.services import movies as movies_services

# def test_get_movie_summaries_success(
#     mocker: MockerFixture,
#     user_factory: Callable[..., User]
# ):
#     n_returned_movies = randint(0, 10)
#     mock_crud = mocker.patch("app.crud.movie.get_movies")
#     mock_crud.return_value = [mocker.MagicMock for _ in range(n_returned_movies)]
#     mock_converter = mocker.patch("app.converters.movie.to_summary_logged_in")
#     mock_session = mocker.MagicMock()
#     mock_get_letterboxd_username = mocker.patch("app.crud.user.get_letterboxd_username")


#     user = user_factory()
#     mock_get_letterboxd_username.return_value = user.letterboxd_username  # Assuming no user is logged in
#     limit = 10
#     offset = 0
#     showtime_limit = 5
#     query = "test"
#     watchlist_only = False
#     snapshot_time = mocker.MagicMock()

#     movies_services.get_movie_summaries(
#         session=mock_session,
#         user_id=user.id,
#         limit=limit,
#         offset=offset,
#         showtime_limit=showtime_limit,
#         query=query,
#         watchlist_only=watchlist_only,
#         snapshot_time=snapshot_time,
#     )

#     mock_crud.assert_called_once_with(
#         session=mock_session,
#         letterboxd_username=user.letterboxd_username,  # Assuming no user is logged in
#         limit=limit,
#         offset=offset,
#         query=query,
#         watchlist_only=watchlist_only,
#         snapshot_time=snapshot_time,
#         current_user_id=user.id,
#     )
#     assert mock_converter.call_count == n_returned_movies


# def test_get_movie_by_id(
#     mocker: MockerFixture,
# ):
#     mock_crud = mocker.patch("app.crud.movie.get_movie_by_id")
#     mock_converter = mocker.patch("app.converters.movie.to_logged_in")
#     mock_session = mocker.MagicMock()

#     current_user = uuid4()
#     movie_id = randint(1, 1000)
#     snapshot_time = mocker.MagicMock()

#     movies_services.get_movie_by_id(
#         session=mock_session,
#         movie_id=movie_id,
#         current_user=current_user,
#         snapshot_time=snapshot_time,
#     )

#     mock_crud.assert_called_once_with(
#         session=mock_session,
#         id=movie_id,
#     )
#     mock_converter.assert_called_once()


# def test_get_movie_by_id_not_found(
#     mocker: MockerFixture,
# ):
#     mock_crud = mocker.patch("app.crud.movie.get_movie_by_id")
#     mock_crud.return_value = None
#     mock_session = mocker.MagicMock()

#     current_user = uuid4()
#     movie_id = randint(1, 1000)
#     snapshot_time = mocker.MagicMock()

#     with pytest.raises(MovieNotFoundError) as exc_info:
#         movies_services.get_movie_by_id(
#             session=mock_session,
#             movie_id=movie_id,
#             current_user=current_user,
#             snapshot_time=snapshot_time,
#         )

#     assert exc_info.value.movie_id == movie_id


def test_insert_movie_if_not_exists_new(
    mocker: MockerFixture,
):
    mock_crud = mocker.patch("app.crud.movie.create_movie")
    mock_session = mocker.MagicMock()
    movie_create = mocker.MagicMock()

    inserted = movies_services.insert_movie_if_not_exists(
        session=mock_session,
        movie_create=movie_create,
    )

    mock_crud.assert_called_once_with(
        session=mock_session,
        movie_create=movie_create,
    )

    assert inserted is True

def test_insert_movie_if_not_exists_exists(
    mocker: MockerFixture,
):
    mock_crud = mocker.patch("app.crud.movie.create_movie")
    mock_crud.side_effect = IntegrityError(
        statement= "Integrity error",
        orig=UniqueViolation("Movie already exists"),
        params=None,
    )
    mock_session = mocker.MagicMock()
    movie_create = mocker.MagicMock()

    inserted = movies_services.insert_movie_if_not_exists(
        session=mock_session,
        movie_create=movie_create,
    )

    assert inserted is False

def test_update_movie(
    mocker: MockerFixture,
):
    mock_get_movie = mocker.patch("app.crud.movie.get_movie_by_id")
    mock_get_movie.return_value = mocker.MagicMock()
    mock_crud = mocker.patch("app.crud.movie.update_movie")
    mock_session = mocker.MagicMock()
    movie_update = mocker.MagicMock()

    movies_services.update_movie(
        session=mock_session,
        movie_id=randint(1, 1000),
        movie_update=movie_update,
    )

    mock_crud.assert_called_once_with(
        db_movie=mock_get_movie.return_value,
        movie_update=movie_update,
    )

def test_update_movie_not_found(
    mocker: MockerFixture
):
    mock_get_movie = mocker.patch("app.crud.movie.get_movie_by_id")
    mock_get_movie.return_value = None
    mock_session = mocker.MagicMock()
    movie_update = mocker.MagicMock()
    movie_id = randint(1, 1000)

    with pytest.raises(MovieNotFoundError) as exc_info:
        movies_services.update_movie(
            session=mock_session,
            movie_id=movie_id,
            movie_update=movie_update,
        )

    assert exc_info.value.movie_id == movie_id
