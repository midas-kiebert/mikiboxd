from random import randint
from uuid import uuid4

import pytest
from psycopg.errors import UniqueViolation
from pytest_mock import MockerFixture
from sqlalchemy.exc import IntegrityError

from app.exceptions.user_exceptions import (
    EmailAlreadyExists,
    NotAFriend,
    UserNotFound,
)
from app.services import users as users_services


def test_user_success(
    mocker: MockerFixture,
):
    mock_crud = mocker.patch("app.crud.user.get_user_by_id")
    mock_converter = mocker.patch("app.converters.user.to_public")
    mock_session = mocker.MagicMock()

    user_id = uuid4()

    users_services.get_user(
        session=mock_session,
        user_id=user_id,
    )

    mock_crud.assert_called_once_with(
        session=mock_session,
        user_id=user_id,
    )
    mock_converter.assert_called_once_with(mock_crud.return_value
)

def test_get_user_not_found(
    mocker: MockerFixture,
):
    mock_crud = mocker.patch("app.crud.user.get_user_by_id")
    mock_crud.return_value = None
    mock_session = mocker.MagicMock()

    user_id = uuid4()

    with pytest.raises(UserNotFound):
        users_services.get_user(
            session=mock_session,
            user_id=user_id,
        )

    mock_crud.assert_called_once_with(
        session=mock_session,
        user_id=user_id,
    )


def test_get_users_success(
    mocker: MockerFixture,
):
    len_results = randint(0, 10)
    mock_crud = mocker.patch("app.crud.user.get_users")
    mock_crud.return_value = [mocker.MagicMock() for _ in range(len_results)]
    mock_converter = mocker.patch("app.converters.user.to_with_friend_status")
    mock_session = mocker.MagicMock()

    current_user_id = uuid4()
    query = "test"
    limit = 10
    offset = 0

    users_services.get_users(
        session=mock_session,
        query=query,
        limit=limit,
        offset=offset,
        current_user_id=current_user_id,
    )

    mock_crud.assert_called_once_with(
        session=mock_session,
        query=query,
        limit=limit,
        offset=offset,
        current_user_id=current_user_id,
    )
    assert mock_converter.call_count == len_results


def test_register_user_success(
    mocker: MockerFixture,
):
    mock_validate = mocker.patch("app.models.user.UserCreate.model_validate")
    mock_crud = mocker.patch("app.crud.user.create_user")
    mock_converter = mocker.patch("app.converters.user.to_public")
    mock_session = mocker.MagicMock()

    user_create = mock_validate.return_value

    users_services.register_user(
        session=mock_session,
        user_in=mocker.MagicMock(),
    )

    mock_crud.assert_called_once_with(
        session=mock_session,
        user_create=user_create,
    )
    mock_converter.assert_called_once_with(mock_crud.return_value)


def test_register_user_email_already_exists(
    mocker: MockerFixture,
):
    mocker.patch("app.models.user.UserCreate.model_validate")
    mock_crud = mocker.patch("app.crud.user.create_user")
    mock_crud.side_effect = IntegrityError(
        "Unique violation", params=None, orig=UniqueViolation("Email already exists")
    )
    mock_session = mocker.MagicMock()

    user_in = mocker.MagicMock()

    with pytest.raises(EmailAlreadyExists):
        users_services.register_user(
            session=mock_session,
            user_in=user_in,
        )

    mock_session.rollback.assert_called_once()


def test_get_selected_showtimes_success(
    mocker: MockerFixture,
):
    len_results = randint(0, 10)
    mock_crud = mocker.patch("app.crud.user.get_selected_showtimes")
    mock_crud.return_value = [mocker.MagicMock() for _ in range(len_results)]
    mock_converter = mocker.patch("app.converters.showtime.to_logged_in")
    are_friends_mock = mocker.patch("app.crud.friendship.are_users_friends")
    are_friends_mock.return_value = True
    mock_session = mocker.MagicMock()
    snapshot_time = mocker.MagicMock()
    limit = 20
    offset = 0

    user_id = uuid4()
    current_user_id = uuid4()

    users_services.get_selected_showtimes(
        session=mock_session,
        user_id=user_id,
        snapshot_time=snapshot_time,
        limit=limit,
        offset=offset,
        current_user_id=current_user_id,
    )

    are_friends_mock.assert_called_once_with(
        session=mock_session,
        user_id=current_user_id,
        friend_id=user_id,
    )

    mock_crud.assert_called_once_with(
        session=mock_session,
        user_id=user_id,
        snapshot_time=snapshot_time,
        limit=limit,
        offset=offset,
    )
    assert mock_converter.call_count == len_results

def test_get_selected_showtimes_self_success(
    mocker: MockerFixture,
):
    len_results = randint(0, 10)
    mock_crud = mocker.patch("app.crud.user.get_selected_showtimes")
    mock_crud.return_value = [mocker.MagicMock() for _ in range(len_results)]
    mock_converter = mocker.patch("app.converters.showtime.to_logged_in")
    are_friends_mock = mocker.patch("app.crud.friendship.are_users_friends")
    are_friends_mock.return_value = False
    mock_session = mocker.MagicMock()
    snapshot_time = mocker.MagicMock()
    limit = 20
    offset = 0

    user_id = uuid4()

    users_services.get_selected_showtimes(
        session=mock_session,
        user_id=user_id,
        snapshot_time=snapshot_time,
        limit=limit,
        offset=offset,
        current_user_id=user_id,
    )

    mock_crud.assert_called_once_with(
        session=mock_session,
        user_id=user_id,
        snapshot_time=snapshot_time,
        limit=limit,
        offset=offset,
    )
    assert mock_converter.call_count == len_results

def test_get_selected_showtimes_not_a_friend(
    mocker: MockerFixture,
):
    are_friends_mock = mocker.patch("app.crud.friendship.are_users_friends")
    are_friends_mock.return_value = False
    mock_session = mocker.MagicMock()
    snapshot_time = mocker.MagicMock()
    limit = 20
    offset = 0

    user_id = uuid4()
    current_user_id = uuid4()

    with pytest.raises(NotAFriend):
        users_services.get_selected_showtimes(
            session=mock_session,
            user_id=user_id,
            snapshot_time=snapshot_time,
            limit=limit,
            offset=offset,
            current_user_id=current_user_id,
        )

    are_friends_mock.assert_called_once_with(
        session=mock_session,
        user_id=current_user_id,
        friend_id=user_id,
    )


def test_get_friends_success(
    mocker: MockerFixture,
):
    len_results = randint(0, 10)
    mock_crud = mocker.patch("app.crud.user.get_friends")
    mock_crud.return_value = [mocker.MagicMock() for _ in range(len_results)]
    mock_converter = mocker.patch("app.converters.user.to_public")
    mock_session = mocker.MagicMock()

    user_id = uuid4()

    users_services.get_friends(
        session=mock_session,
        user_id=user_id,
    )

    mock_crud.assert_called_once_with(
        session=mock_session,
        user_id=user_id,
    )
    assert mock_converter.call_count == len_results


def test_get_sent_friend_requests(
    mocker: MockerFixture,
):
    len_results = randint(0, 10)
    mock_crud = mocker.patch("app.crud.user.get_sent_friend_requests")
    mock_crud.return_value = [mocker.MagicMock() for _ in range(len_results)]
    mock_converter = mocker.patch("app.converters.user.to_public")
    mock_session = mocker.MagicMock()

    user_id = uuid4()

    users_services.get_sent_friend_requests(
        session=mock_session,
        user_id=user_id,
    )

    mock_crud.assert_called_once_with(
        session=mock_session,
        user_id=user_id,
    )
    assert mock_converter.call_count == len_results


def test_get_recieved_friend_requests(
    mocker: MockerFixture,
):
    len_results = randint(0, 10)
    mock_crud = mocker.patch("app.crud.user.get_received_friend_requests")
    mock_crud.return_value = [mocker.MagicMock() for _ in range(len_results)]
    mock_converter = mocker.patch("app.converters.user.to_public")
    mock_session = mocker.MagicMock()

    user_id = uuid4()

    users_services.get_received_friend_requests(
        session=mock_session,
        user_id=user_id,
    )

    mock_crud.assert_called_once_with(
        session=mock_session,
        user_id=user_id,
    )
    assert mock_converter.call_count == len_results
