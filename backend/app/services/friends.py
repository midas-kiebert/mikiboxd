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
from app.services import push_notifications


def create_friend_request(
    *,
    session: Session,
    sender_id: UUID,
    receiver_id: UUID,
) -> Message:
    """
    Create a friend request from sender to receiver.

    If receiver_id already has a pending request to sender_id (both sides
    requested each other, likely because one side's client hadn't yet shown
    the other's incoming request), this resolves the pair as friends
    immediately instead of leaving two open requests sitting unresolved.

    Already being friends is treated the same way: a no-op success rather
    than a dangling pending request that can never be accepted (the client
    hides the "Add" action once friends, so this only matters for a stale
    client, a race with another action, or a direct API call).

    Raises:
        FriendRequestAlreadyExistsError: If a friend request already exists.
        OneOrMoreUsersNotFound: If one or both users do not exist.
        AppError: For any other (unexpected) errors.
    """
    if friendship_crud.are_users_friends(
        session=session, user_id=sender_id, friend_id=receiver_id
    ):
        return Message(message="You are already friends.")

    if friendship_crud.has_sent_friend_request(
        session=session, sender_id=receiver_id, receiver_id=sender_id
    ):
        try:
            return accept_friend_request(
                session=session,
                current_user_id=sender_id,
                sender_id=receiver_id,
            )
        except FriendRequestNotFoundError:
            # The reverse request was cancelled/accepted between the check
            # above and here — fall through to a normal forward request.
            pass

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

    push_notifications.notify_user_on_friend_request(
        session=session,
        sender_id=sender_id,
        receiver_id=receiver_id,
    )
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

    push_notifications.notify_user_on_friend_request_accepted(
        session=session,
        accepter_id=current_user_id,
        requester_id=sender_id,
    )
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


def set_friend_status_sharing(
    *,
    session: Session,
    current_user: UUID,
    friend_id: UUID,
    shares_status: bool,
) -> Message:
    """
    Set whether the current user shares their status with a friend by default.
    Raises:
        FriendshipNotFoundError: If the friendship does not exist.
        AppError: For any other (unexpected) errors.
    """
    try:
        friendship_crud.set_friendship_status_sharing(
            session=session,
            owner_id=current_user,
            friend_id=friend_id,
            shares_status=shares_status,
        )
        session.commit()
    except NoResultFound as e:
        session.rollback()
        raise FriendshipNotFoundError(current_user, friend_id) from e
    except Exception as e:
        session.rollback()
        raise AppError from e
    return Message(message="Friend status sharing updated successfully.")


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
