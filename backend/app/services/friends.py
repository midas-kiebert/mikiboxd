from uuid import UUID

from psycopg.errors import ForeignKeyViolation, UniqueViolation
from sqlalchemy.exc import IntegrityError, NoResultFound
from sqlmodel import Session

from app.crud import friendship as friendship_crud
from app.exceptions.base import AppError
from app.exceptions.friends_exceptions import (
    FriendRequestAlreadyExistsError,
    FriendRequestNotFoundError,
    FriendshipAlreadyExistsError,
    FriendshipNotFoundError,
)
from app.exceptions.user_exceptions import OneOrMoreUsersNotFound
from app.models.auth_schemas import Message


def create_friend_request(
    *,
    session: Session,
    sender_id: UUID,
    receiver_id: UUID,
) -> Message:
    """
    Create a friend request from sender to receiver.
    Raises:
        FriendRequestAlreadyExistsError: If a friend request already exists.
        OneOrMoreUsersNotFound: If one or both users do not exist.
        AppError: For any other (unexpected) errors.
    """
    try:
        friendship_crud.create_friend_request(
            session=session,
            sender_id=sender_id,
            receiver_id=receiver_id,
        )
        session.commit()
    except IntegrityError as e:
        session.rollback()
        if isinstance(e.orig, UniqueViolation):
            raise FriendRequestAlreadyExistsError(sender_id, receiver_id) from e
        elif isinstance(e.orig, ForeignKeyViolation):
            raise OneOrMoreUsersNotFound([sender_id, receiver_id]) from e
        else:
            raise AppError from e
    except Exception as e:
        session.rollback()
        raise AppError from e
    return Message(message="Friend request sent successfully.")


def accept_friend_request(
    *,
    session: Session,
    current_user_id: UUID,
    sender_id: UUID,
) -> Message:
    """
    Accept a friend request from sender_id to current_user_id.
    Raises:
        FriendshipAlreadyExistsError: If a friendship already exists.
        FriendRequestNotFoundError: If the friend request does not exist.
        OneOrMoreUsersNotFound: If one or both users do not exist.
        AppError: For any other (unexpected) errors.
    """
    try:
        friendship_crud.delete_friend_request(
            session=session,
            receiver_id=current_user_id,
            sender_id=sender_id,
        )
        friendship_crud.create_friendship(
            session=session,
            user_id=current_user_id,
            friend_id=sender_id,
        )
        session.commit()
    except IntegrityError as e:
        session.rollback()
        if isinstance(e.orig, UniqueViolation):
            raise FriendshipAlreadyExistsError(current_user_id, sender_id) from e
        elif isinstance(e.orig, ForeignKeyViolation):
            raise OneOrMoreUsersNotFound([current_user_id, sender_id]) from e
        else:
            raise AppError from e
    except NoResultFound as e:
        session.rollback()
        raise FriendRequestNotFoundError(sender_id, current_user_id) from e
    except Exception as e:
        session.rollback()
        raise AppError from e
    return Message(message="Friend request accepted successfully.")


def decline_friend_request(
    *,
    session: Session,
    current_user: UUID,
    sender_id: UUID,
) -> Message:
    """
    Decline a friend request from sender_id to current_user.
    Raises:
        FriendRequestNotFoundError: If the friend request does not exist.
        AppError: For any other (unexpected) errors.
    """
    try:
        friendship_crud.delete_friend_request(
            session=session,
            receiver_id=current_user,
            sender_id=sender_id,
        )
        session.commit()
    except NoResultFound as e:
        session.rollback()
        raise FriendRequestNotFoundError(sender_id, current_user) from e
    except Exception as e:
        session.rollback()
        raise AppError from e
    return Message(message="Friend request declined successfully.")


def cancel_friend_request(
    *,
    session: Session,
    current_user: UUID,
    receiver_id: UUID,
) -> Message:
    """
    Cancel a friend request sent by current_user to receiver_id.
    Raises:
        FriendRequestNotFoundError: If the friend request does not exist.
        AppError: For any other (unexpected) errors.
    """
    try:
        friendship_crud.delete_friend_request(
            session=session,
            sender_id=current_user,
            receiver_id=receiver_id,
        )
        session.commit()
    except NoResultFound as e:
        session.rollback()
        raise FriendRequestNotFoundError(current_user, receiver_id) from e
    except Exception as e:
        session.rollback()
        raise AppError from e
    return Message(message="Friend request cancelled successfully.")


def remove_friend(
    *,
    session: Session,
    current_user: UUID,
    friend_id: UUID,
) -> Message:
    """
    Remove a friend from current_user's friend list.
    Raises:
        FriendshipNotFoundError: If the friendship does not exist.
        AppError: For any other (unexpected) errors.
    """
    try:
        friendship_crud.delete_friendship(
            session=session,
            user_id=current_user,
            friend_id=friend_id,
        )
        session.commit()
    except NoResultFound as e:
        session.rollback()
        raise FriendshipNotFoundError(current_user, friend_id) from e
    except Exception as e:
        session.rollback()
        raise AppError from e
    return Message(message="Friend removed successfully.")
