from uuid import UUID

from sqlmodel import Session

from app.converters import showtime as showtime_converters
from app.crud import friendship as friendship_crud
from app.crud import user as user_crud
from app.models.user import User
from app.schemas.user import UserPublic, UserWithFriendStatus, UserWithShowtimesPublic


def to_public(user: User) -> UserPublic:
    User.model_validate(user)
    last_watchlist_sync = (
        user.letterboxd.last_watchlist_sync if user.letterboxd else None
    )
    return UserPublic(
        **user.model_dump(),
        last_watchlist_sync=last_watchlist_sync,
    )


def to_with_friend_status(
    user: User,
    *,
    session: Session,
    current_user: UUID,
) -> UserWithFriendStatus:
    """
    Converts a User object to a UserWithFriendStatus object, including friendship status
    and friend request status between the current user and the specified user.

    Parameters:
        user (User): The User object to convert.
        session (Session): The SQLAlchemy session for database operations.
        current_user (UUID): The ID of the current user.
    Returns:
        UserWithFriendStatus: The converted UserWithFriendStatus object with friendship details.
    Raises:
        ValidationError: If the user does not match the expected model.
    """
    User.model_validate(user)
    is_friend = friendship_crud.are_users_friends(
        session=session,
        user_id=current_user,
        friend_id=user.id,
    )
    sent_request = friendship_crud.has_sent_friend_request(
        session=session,
        sender_id=current_user,
        receiver_id=user.id,
    )
    received_request = friendship_crud.has_sent_friend_request(
        session=session,
        sender_id=user.id,
        receiver_id=current_user,
    )
    last_watchlist_sync = (
        user.letterboxd.last_watchlist_sync if user.letterboxd else None
    )

    return UserWithFriendStatus(
        **user.model_dump(),
        is_friend=is_friend,
        sent_request=sent_request,
        received_request=received_request,
        last_watchlist_sync=last_watchlist_sync,
    )


def to_with_showtimes_public(
    user: User,
    *,
    session: Session,
    limit: int,
    offset: int,
) -> UserWithShowtimesPublic:
    """
    Converts a User object to a UserPublic object, including showtimes.

    Parameters:
        user (User): The User object to convert.
    Returns:
        UserPublic: The converted UserPublic object with showtimes.
    Raises:
        ValidationError: If the user does not match the expected model.
    """
    User.model_validate(user)
    showtimes = [
        showtime_converters.to_logged_in(
            showtime=showtime,
            session=session,
            user_id=user.id,
        )
        for showtime in user_crud.get_selected_showtimes(
            session=session,
            user_id=user.id,
            limit=limit,
            offset=offset,
        )
    ]

    last_watchlist_sync = (
        user.letterboxd.last_watchlist_sync if user.letterboxd else None
    )

    return UserWithShowtimesPublic(
        **user.model_dump(),
        showtimes_going=showtimes,
        last_watchlist_sync=last_watchlist_sync,
    )
