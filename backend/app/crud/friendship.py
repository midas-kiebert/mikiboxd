from uuid import UUID

from sqlmodel import Session, select

from app.models.friendship import FriendRequest, Friendship


def create_friendship(
    *,
    session: Session,
    user_id: UUID,
    friend_id: UUID,
) -> Friendship:
    """
    Create a two-way friendship between two users.

    Parameters:
        session (Session): The database session.
        user_id (UUID): The ID of the user creating the friendship.
        friend_id (UUID): The ID of the user to be added as a friend.
    Returns:
        Friendship: The created friendship object.
    Raises:
        IntegrityError: If a friendship already exists between the users.
        ForeignKeyViolation: If either user does not exist in the database.
    """

    friendship = Friendship(user_id=user_id, friend_id=friend_id)
    reverse_friendship = Friendship(user_id=friend_id, friend_id=user_id)
    session.add(friendship)
    session.add(reverse_friendship)
    session.flush()
    return friendship


def are_users_friends(
    *,
    session: Session,
    user_id: UUID,
    friend_id: UUID,
) -> bool:
    """
    Check if two users are friends.

    Parameters:
        session (Session): The database session.
        user_id (UUID): The ID of the first user.
        friend_id (UUID): The ID of the second user.
    Returns:
        bool: True if the users are friends, False otherwise.
    """
    friendship = session.exec(
        select(Friendship).where(
            Friendship.user_id == user_id,
            Friendship.friend_id == friend_id
        )
    ).one_or_none()
    return friendship is not None


def create_friend_request(
    *,
    session: Session,
    sender_id: UUID,
    receiver_id: UUID,
) -> FriendRequest:
    """
    Create a friend request from one user to another.

    Parameters:
        session (Session): The database session.
        sender_id (UUID): The ID of the user sending the request.
        receiver_id (UUID): The ID of the user receiving the request.

    Returns:
        FriendRequest: The created or existing friend request object.
    Raises:
        IntegrityError: If a friend request already exists between the users.
        ForeignKeyViolation: If either user does not exist in the database.
    """

    friend_request = FriendRequest(sender_id=sender_id, receiver_id=receiver_id)
    session.add(friend_request)
    session.flush()

    return friend_request


def has_sent_friend_request(
    *,
    session: Session,
    sender_id: UUID,
    receiver_id: UUID,
) -> bool:
    """
    Check if a user has sent a friend request to another user.

    Parameters:
        session (Session): The database session.
        sender_id (UUID): The ID of the user who sent the request.
        receiver_id (UUID): The ID of the user who received the request.
    Returns:
        bool: True if the request exists, False otherwise.
    Raises:
        MultipleResultsFound: If multiple requests exist (should not happen in a well-formed database).
    """
    request = session.exec(
        select(FriendRequest).where(
            FriendRequest.sender_id == sender_id,
            FriendRequest.receiver_id == receiver_id,
        )
    ).one_or_none()
    return request is not None


def delete_friendship(
    *,
    session: Session,
    user_id: UUID,
    friend_id: UUID,
) -> Friendship:
    """
    Delete a friendship between two users.
    This will delete both directions of the friendship.

    Parameters:
        session (Session): The database session.
        user_id (UUID): The ID of the user who is deleting the friendship.
        friend_id (UUID): The ID of the user to be removed as a friend.
    Returns:
        Friendship: The deleted friendship object if it existed.
    Raises:
        NoResultsFound: If no friendship exists between the users.
        MultipleResultsFound: If multiple friendships exist (should not happen in a well-formed database).
    """
    friendship = session.exec(
        select(Friendship).where(
            Friendship.user_id == user_id, Friendship.friend_id == friend_id
        )
    ).one()
    reverse_friendship = session.exec(
        select(Friendship).where(
            Friendship.user_id == friend_id, Friendship.friend_id == user_id
        )
    ).one()

    session.delete(friendship)
    session.delete(reverse_friendship)

    return friendship


def delete_friend_request(
    *,
    session: Session,
    sender_id: UUID,
    receiver_id: UUID,
) -> FriendRequest:
    """
    Delete a friend request sent from one user to another.

    Parameters:
        session (Session): The database session.
        sender_id (UUID): The ID of the user who sent the request.
        receiver_id (UUID): The ID of the user who received the request.
    Returns:
        FriendRequest : The deleted friend request object.
    Raises:
        NoResultsFound: If no friend request exists between the users.
        MultipleResultsFound: If multiple requests exist (should not happen in a well-formed database).
    """
    request = session.exec(
        select(FriendRequest).where(
            FriendRequest.sender_id == sender_id,
            FriendRequest.receiver_id == receiver_id,
        )
    ).one()

    session.delete(request)
    return request
