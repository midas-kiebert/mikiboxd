from uuid import UUID

from sqlmodel import Session

from app.converters import showtime as showtime_converters
from app.crud import friendship as friendship_crud
from app.crud import user as user_crud
from app.inputs.movie import Filters
from app.models.user import User
from app.schemas.user import (
    UserMe,
    UserPublic,
    UserWithFriendStatus,
    UserWithShowtimesPublic,
)
from app.utils import now_amsterdam_naive


def to_public(user: User) -> UserPublic:
    User.model_validate(user)
    return UserPublic(
        id=user.id,
        is_active=user.is_active,
        display_name=user.display_name,
    )


def to_me(user: User) -> UserMe:
    User.model_validate(user)
    return UserMe(
        id=user.id,
        is_active=user.is_active,
        display_name=user.display_name,
        email=user.email,
        is_superuser=user.is_superuser,
        notify_on_friend_showtime_match=user.notify_on_friend_showtime_match,
        notify_on_friend_requests=user.notify_on_friend_requests,
        notify_on_showtime_ping=user.notify_on_showtime_ping,
        notify_on_interest_reminder=user.notify_on_interest_reminder,
        notify_channel_friend_showtime_match=user.notify_channel_friend_showtime_match,
        notify_channel_friend_requests=user.notify_channel_friend_requests,
        notify_channel_showtime_ping=user.notify_channel_showtime_ping,
        notify_channel_interest_reminder=user.notify_channel_interest_reminder,
        letterboxd_username=user.letterboxd_username,
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
    return UserWithFriendStatus(
        id=user.id,
        is_active=user.is_active,
        display_name=user.display_name,
        is_friend=is_friend,
        sent_request=sent_request,
        received_request=received_request,
    )


def to_with_showtimes_public(
    user: User,
    *,
    session: Session,
    limit: int,
    offset: int,
    filters: Filters,
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

    now = now_amsterdam_naive()
    filters.snapshot_time = now

    User.model_validate(user)
    showtimes = [
        showtime_converters.to_logged_in(
            showtime=showtime, session=session, user_id=user.id, filters=filters
        )
        for showtime in user_crud.get_selected_showtimes(
            session=session,
            user_id=user.id,
            viewer_id=user.id,
            limit=limit,
            offset=offset,
            filters=filters,
            letterboxd_username=user.letterboxd_username,
        )
    ]

    return UserWithShowtimesPublic(
        id=user.id,
        is_active=user.is_active,
        display_name=user.display_name,
        showtimes_going=showtimes,
    )
