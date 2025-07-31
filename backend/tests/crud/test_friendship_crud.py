from collections.abc import Callable

import pytest
from psycopg.errors import UniqueViolation
from sqlalchemy.exc import IntegrityError, NoResultFound
from sqlmodel import Session

from app.crud import friendship as friendship_crud
from app.models.user import User


def test_create_friendship_success(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
):
    user1 = user_factory()
    user2 = user_factory()

    friendship_exists_no = friendship_crud.are_users_friends(
        session=db_transaction, user_id=user1.id, friend_id=user2.id
    )
    assert not friendship_exists_no

    friendship_crud.create_friendship(
        session=db_transaction, user_id=user1.id, friend_id=user2.id
    )

    friendship_exists = friendship_crud.are_users_friends(
        session=db_transaction, user_id=user1.id, friend_id=user2.id
    )
    reverse_friendship_exists = friendship_crud.are_users_friends(
        session=db_transaction, user_id=user2.id, friend_id=user1.id
    )
    assert friendship_exists
    assert reverse_friendship_exists


def test_create_friendship_duplicate(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
):
    user1 = user_factory()
    user2 = user_factory()

    friendship_crud.create_friendship(
        session=db_transaction, user_id=user1.id, friend_id=user2.id
    )

    with pytest.raises(IntegrityError) as exc_info:
        friendship_crud.create_friendship(
            session=db_transaction, user_id=user1.id, friend_id=user2.id
        )

    assert isinstance(exc_info.value.orig, UniqueViolation)


def test_create_friend_request_success(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
):
    sender = user_factory()
    receiver = user_factory()

    friendship_crud.create_friend_request(
        session=db_transaction, sender_id=sender.id, receiver_id=receiver.id
    )

    friend_request_exists = friendship_crud.has_sent_friend_request(
        session=db_transaction, sender_id=sender.id, receiver_id=receiver.id
    )

    reverse_friend_request_exists = friendship_crud.has_sent_friend_request(
        session=db_transaction, sender_id=receiver.id, receiver_id=sender.id
    )

    assert friend_request_exists
    assert not reverse_friend_request_exists


def test_create_friend_request_duplicate(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
):
    sender = user_factory()
    receiver = user_factory()

    friendship_crud.create_friend_request(
        session=db_transaction, sender_id=sender.id, receiver_id=receiver.id
    )

    with pytest.raises(IntegrityError) as exc_info:
        friendship_crud.create_friend_request(
            session=db_transaction, sender_id=sender.id, receiver_id=receiver.id
        )

    assert isinstance(exc_info.value.orig, UniqueViolation)


def test_delete_friendship_success(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
):
    user1 = user_factory()
    user2 = user_factory()

    friendship_crud.create_friendship(
        session=db_transaction, user_id=user1.id, friend_id=user2.id
    )

    friendship_exists_before = friendship_crud.are_users_friends(
        session=db_transaction, user_id=user1.id, friend_id=user2.id
    )
    assert friendship_exists_before

    friendship_crud.delete_friendship(
        session=db_transaction, user_id=user1.id, friend_id=user2.id
    )

    friendship_exists_after = friendship_crud.are_users_friends(
        session=db_transaction, user_id=user1.id, friend_id=user2.id
    )
    reverse_friendship_exists_after = friendship_crud.are_users_friends(
        session=db_transaction, user_id=user2.id, friend_id=user1.id
    )
    assert not friendship_exists_after
    assert not reverse_friendship_exists_after


def test_delete_friendship_not_found(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
):
    user1 = user_factory()
    user2 = user_factory()

    with pytest.raises(NoResultFound):
        friendship_crud.delete_friendship(
            session=db_transaction, user_id=user1.id, friend_id=user2.id
        )


def test_delete_friend_request_success(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
):
    sender = user_factory()
    receiver = user_factory()

    friendship_crud.create_friend_request(
        session=db_transaction, sender_id=sender.id, receiver_id=receiver.id
    )

    friend_request_exists_before = friendship_crud.has_sent_friend_request(
        session=db_transaction, sender_id=sender.id, receiver_id=receiver.id
    )
    assert friend_request_exists_before

    friendship_crud.delete_friend_request(
        session=db_transaction, sender_id=sender.id, receiver_id=receiver.id
    )

    friend_request_exists_after = friendship_crud.has_sent_friend_request(
        session=db_transaction, sender_id=sender.id, receiver_id=receiver.id
    )
    reverse_friend_request_exists_after = friendship_crud.has_sent_friend_request(
        session=db_transaction, sender_id=receiver.id, receiver_id=sender.id
    )
    assert not friend_request_exists_after
    assert not reverse_friend_request_exists_after


def test_delete_friend_request_not_found(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
):
    sender = user_factory()
    receiver = user_factory()

    with pytest.raises(NoResultFound):
        friendship_crud.delete_friend_request(
            session=db_transaction, sender_id=sender.id, receiver_id=receiver.id
        )
