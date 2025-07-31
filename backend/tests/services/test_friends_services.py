from uuid import uuid4

import pytest
from psycopg.errors import ForeignKeyViolation, UniqueViolation
from pytest_mock import MockerFixture
from sqlalchemy.exc import IntegrityError, NoResultFound

from app.exceptions.friends_exceptions import (
    FriendRequestAlreadyExistsError,
    FriendRequestNotFoundError,
    FriendshipAlreadyExistsError,
    FriendshipNotFoundError,
)
from app.exceptions.user_exceptions import OneOrMoreUsersNotFound
from app.services import friends as friends_services


def test_create_friend_request_success(
    mocker: MockerFixture,
):
    mock_crud = mocker.patch("app.crud.friendship.create_friend_request")
    mock_session = mocker.MagicMock()

    sender_id = uuid4()
    receiver_id = uuid4()

    result = friends_services.create_friend_request(
        session=mock_session,
        sender_id=sender_id,
        receiver_id=receiver_id,
    )

    mock_crud.assert_called_once_with(
        session=mock_session,
        sender_id=sender_id,
        receiver_id=receiver_id,
    )
    mock_session.commit.assert_called_once()
    assert result.message == "Friend request sent successfully."


@pytest.mark.parametrize(
    "org_exc, expected_exc",
    [
        (UniqueViolation, FriendRequestAlreadyExistsError),
        (ForeignKeyViolation, OneOrMoreUsersNotFound),
    ],
)
def test_create_friend_failure(
    mocker: MockerFixture,
    org_exc,
    expected_exc,
):
    mock_crud = mocker.patch("app.crud.friendship.create_friend_request")
    mock_crud.side_effect = IntegrityError(
        statement="Integrity error", orig=org_exc("Integrity violation"), params=None
    )
    mock_session = mocker.MagicMock()

    sender_id = uuid4()
    receiver_id = uuid4()

    with pytest.raises(expected_exc):
        friends_services.create_friend_request(
            session=mock_session,
            sender_id=sender_id,
            receiver_id=receiver_id,
        )

    mock_session.rollback.assert_called_once()


def test_accept_friend_request_success(
    mocker: MockerFixture,
):
    mock_create_crud = mocker.patch("app.crud.friendship.create_friendship")
    mock_delete_crud = mocker.patch("app.crud.friendship.delete_friend_request")
    mock_session = mocker.MagicMock()

    current_user_id = uuid4()
    sender_id = uuid4()

    result = friends_services.accept_friend_request(
        session=mock_session,
        current_user_id=current_user_id,
        sender_id=sender_id,
    )

    mock_delete_crud.assert_called_once_with(
        session=mock_session,
        receiver_id=current_user_id,
        sender_id=sender_id,
    )
    mock_create_crud.assert_called_once_with(
        session=mock_session,
        user_id=current_user_id,
        friend_id=sender_id,
    )

    mock_session.commit.assert_called_once()
    assert result.message == "Friend request accepted successfully."


@pytest.mark.parametrize(
    "org_exc, expected_exc",
    [
        (UniqueViolation, FriendshipAlreadyExistsError),
        (ForeignKeyViolation, OneOrMoreUsersNotFound),
    ],
)
def test_accept_friend_request_integrity_error(
    mocker: MockerFixture,
    org_exc,
    expected_exc,
):
    mock_crud = mocker.patch("app.crud.friendship.create_friendship")
    mock_crud.side_effect = IntegrityError(
        statement="Integrity error", orig=org_exc("Integrity violation"), params=None
    )
    mock_session = mocker.MagicMock()

    current_user_id = uuid4()
    sender_id = uuid4()

    with pytest.raises(expected_exc):
        friends_services.accept_friend_request(
            session=mock_session,
            current_user_id=current_user_id,
            sender_id=sender_id,
        )

    mock_session.rollback.assert_called_once()


def test_accept_friend_request_not_found(
    mocker: MockerFixture,
):
    mock_crud = mocker.patch("app.crud.friendship.delete_friend_request")
    mock_crud.side_effect = NoResultFound("Friend request not found")
    mock_session = mocker.MagicMock()

    current_user_id = uuid4()
    sender_id = uuid4()

    with pytest.raises(FriendRequestNotFoundError):
        friends_services.accept_friend_request(
            session=mock_session,
            current_user_id=current_user_id,
            sender_id=sender_id,
        )

    mock_session.rollback.assert_called_once()


def test_decline_friend_request_success(
    mocker: MockerFixture,
):
    mock_crud = mocker.patch("app.crud.friendship.delete_friend_request")
    mock_session = mocker.MagicMock()

    current_user_id = uuid4()
    sender_id = uuid4()

    result = friends_services.decline_friend_request(
        session=mock_session, current_user=current_user_id, sender_id=sender_id
    )

    mock_crud.assert_called_once_with(
        session=mock_session,
        receiver_id=current_user_id,
        sender_id=sender_id,
    )

    mock_session.commit.assert_called_once()
    assert result.message == "Friend request declined successfully."


def test_decline_friend_request_not_found(
    mocker: MockerFixture,
):
    mock_crud = mocker.patch("app.crud.friendship.delete_friend_request")
    mock_crud.side_effect = NoResultFound("Friend request not found")
    mock_session = mocker.MagicMock()

    current_user_id = uuid4()
    sender_id = uuid4()

    with pytest.raises(FriendRequestNotFoundError):
        friends_services.decline_friend_request(
            session=mock_session, current_user=current_user_id, sender_id=sender_id
        )

    mock_session.rollback.assert_called_once()


def test_cancel_friend_request_success(
    mocker: MockerFixture,
):
    mock_crud = mocker.patch("app.crud.friendship.delete_friend_request")
    mock_session = mocker.MagicMock()

    current_user_id = uuid4()
    receiver_id = uuid4()

    result = friends_services.cancel_friend_request(
        session=mock_session,
        current_user=current_user_id,
        receiver_id=receiver_id,
    )

    mock_crud.assert_called_once_with(
        session=mock_session,
        sender_id=current_user_id,
        receiver_id=receiver_id,
    )

    mock_session.commit.assert_called_once()
    assert result.message == "Friend request cancelled successfully."


def test_cancel_friend_request_not_found(
    mocker: MockerFixture,
):
    mock_crud = mocker.patch("app.crud.friendship.delete_friend_request")
    mock_crud.side_effect = NoResultFound("Friend request not found")
    mock_session = mocker.MagicMock()

    current_user_id = uuid4()
    receiver_id = uuid4()

    with pytest.raises(FriendRequestNotFoundError):
        friends_services.cancel_friend_request(
            session=mock_session,
            current_user=current_user_id,
            receiver_id=receiver_id,
        )

    mock_session.rollback.assert_called_once()


def test_remove_friend_success(
    mocker: MockerFixture,
):
    mock_crud = mocker.patch("app.crud.friendship.delete_friendship")
    mock_session = mocker.MagicMock()

    current_user_id = uuid4()
    friend_id = uuid4()

    result = friends_services.remove_friend(
        session=mock_session,
        current_user=current_user_id,
        friend_id=friend_id,
    )

    mock_crud.assert_called_once_with(
        session=mock_session,
        user_id=current_user_id,
        friend_id=friend_id,
    )

    mock_session.commit.assert_called_once()
    assert result.message == "Friend removed successfully."


def test_remove_friend_not_found(
    mocker: MockerFixture,
):
    mock_crud = mocker.patch("app.crud.friendship.delete_friendship")
    mock_crud.side_effect = NoResultFound("Friendship not found")
    mock_session = mocker.MagicMock()

    current_user_id = uuid4()
    friend_id = uuid4()

    with pytest.raises(FriendshipNotFoundError):
        friends_services.remove_friend(
            session=mock_session,
            current_user=current_user_id,
            friend_id=friend_id,
        )

    mock_session.rollback.assert_called_once()
