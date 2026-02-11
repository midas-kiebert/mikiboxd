from uuid import UUID

from psycopg.errors import UniqueViolation
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session

from app.converters import showtime as showtime_converters
from app.converters import user as user_converters
from app.crud import cinema as cinemas_crud
from app.crud import friendship as friendship_crud
from app.crud import user as users_crud
from app.exceptions.base import AppError
from app.exceptions.user_exceptions import EmailAlreadyExists, NotAFriend, UserNotFound
from app.inputs.movie import Filters
from app.models.user import UserCreate, UserRegister
from app.schemas.showtime import ShowtimeLoggedIn
from app.schemas.user import UserPublic, UserWithFriendStatus


def get_user(
    *,
    session: Session,
    user_id: UUID,
) -> UserPublic:
    """
    Get a user by their ID.

    Parameters:
        session (Session): Database session.
        user_id (UUID): ID of the user to retrieve.
    Returns:
        UserPublic: The public representation of the user.
    Raises:
        UserNotFound: If the user with the given ID does not exist.
    """
    user_db = users_crud.get_user_by_id(session=session, user_id=user_id)
    if not user_db:
        raise UserNotFound(user_id)
    return user_converters.to_public(user_db)


def get_users(
    *,
    session: Session,
    query: str,
    limit: int,
    offset: int,
    current_user_id: UUID,
) -> list[UserWithFriendStatus]:
    """
    Get a list of users with their friend status for the current user.

    Parameters:
        session (Session): Database session.
        query (str): Search query for filtering users.
        limit (int): Maximum number of users to return.
        offset (int): Offset for pagination.
        current_user_id (UUID): ID of the current user.
    Returns:
        list[UserWithFriendStatus]: List of users with their friend status.
    """
    users_db = users_crud.get_users(
        session=session,
        query=query,
        limit=limit,
        offset=offset,
        current_user_id=current_user_id,
    )
    return [
        user_converters.to_with_friend_status(
            user_db, session=session, current_user=current_user_id
        )
        for user_db in users_db
    ]


def get_selected_showtimes(
    *,
    session: Session,
    current_user_id: UUID,
    user_id: UUID,
    limit: int,
    offset: int,
    filters: Filters,
) -> list[ShowtimeLoggedIn]:
    """
    Get the showtimes selected by a user.

    Parameters:
        session (Session): Database session.
        user_id (UUID): ID of the user whose selected showtimes are to be retrieved.
    Returns:
        list[ShowtimeLoggedIn]: List of showtimes selected by the user.
    """
    is_friend = friendship_crud.are_users_friends(
        session=session,
        user_id=current_user_id,
        friend_id=user_id,
    )

    if user_id != current_user_id and not is_friend:
        raise NotAFriend(user_id=user_id)

    letterboxd_username = None
    if filters.watchlist_only:
        letterboxd_username = users_crud.get_letterboxd_username(
            session=session,
            user_id=current_user_id,
        )

    showtimes = users_crud.get_selected_showtimes(
        session=session,
        user_id=user_id,
        limit=limit,
        offset=offset,
        filters=filters,
        letterboxd_username=letterboxd_username,
    )
    return [
        showtime_converters.to_logged_in(
            showtime=showtime, session=session, user_id=current_user_id, filters=filters
        )
        for showtime in showtimes
    ]


def get_friends(
    *,
    session: Session,
    user_id: UUID,
) -> list[UserWithFriendStatus]:
    """
    Get the friends of a user.

    Parameters:
        session (Session): Database session.
        user_id (UUID): ID of the user whose friends are to be retrieved.
    Returns:
        list[UserWithFriendStatus]: List of friends of the user.
    """
    friends = users_crud.get_friends(session=session, user_id=user_id)
    return [
        user_converters.to_with_friend_status(
            session=session, current_user=user_id, user=friend
        )
        for friend in friends
    ]


def get_sent_friend_requests(
    *,
    session: Session,
    user_id: UUID,
) -> list[UserWithFriendStatus]:
    """
    Get the friend requests sent by a user.

    Parameters:
        session (Session): Database session.
        user_id (UUID): ID of the user whose sent friend requests are to be retrieved.
    Returns:
        list[UserWithFriendStatus]: List of users to whom the friend requests were sent.
    """
    requests = users_crud.get_sent_friend_requests(
        session=session,
        user_id=user_id,
    )
    return [
        user_converters.to_with_friend_status(
            session=session, current_user=user_id, user=request
        )
        for request in requests
    ]


def get_received_friend_requests(
    *,
    session: Session,
    user_id: UUID,
) -> list[UserWithFriendStatus]:
    """
    Get the friend requests received by a user.

    Parameters:
        session (Session): Database session.
        user_id (UUID): ID of the user whose received friend requests are to be retrieved.
    Returns:
        list[UserWithFriendStatus]: List of users who sent friend requests to the user.
    """
    requests = users_crud.get_received_friend_requests(
        session=session,
        user_id=user_id,
    )
    return [
        user_converters.to_with_friend_status(
            session=session, current_user=user_id, user=request
        )
        for request in requests
    ]


def get_selected_cinemas_ids(
    *,
    session: Session,
    user_id: UUID,
) -> list[int]:
    """
    Get the IDs of cinemas selected by a user.

    Parameters:
        session (Session): Database session.
        user_id (UUID): ID of the user whose selected cinemas are to be retrieved.
    Returns:
        list[int]: List of cinema IDs selected by the user.
    """
    return users_crud.get_selected_cinemas_ids(session=session, user_id=user_id)


def set_cinema_selections(
    *,
    session: Session,
    user_id: UUID,
    cinema_ids: list[int],
) -> None:
    """
    Set the cinema selections for a user.

    Parameters:
        session (Session): Database session.
        user_id (UUID): ID of the user whose cinema selections are to be set.
        cinema_ids (list[int]): List of cinema IDs to be selected by the user.
    """
    try:
        users_crud.set_cinema_selections(
            session=session,
            user_id=user_id,
            cinema_ids=cinema_ids,
        )
        session.commit()
        print("Cinemas have been updated:" + str(cinema_ids))
    except Exception as e:
        session.rollback()
        raise AppError from e


def select_all_cinemas(
    *,
    session: Session,
    user_id: UUID,
) -> None:
    """
    Select all cinemas for a user.

    Parameters:
        session (Session): Database session.
        user_id (UUID): ID of the user whose cinema selections are to be set to all cinemas.
    """
    try:
        all_cinemas = cinemas_crud.get_cinemas(
            session=session,
        )
        all_cinema_ids = [cinema.id for cinema in all_cinemas]
        users_crud.set_cinema_selections(
            session=session,
            user_id=user_id,
            cinema_ids=all_cinema_ids,
        )
        session.commit()
    except Exception as e:
        session.rollback()
        raise AppError from e


def register_user(
    *,
    session: Session,
    user_in: UserRegister,
) -> UserPublic:
    """
    Register a new user in the system.

    Parameters:
        session (Session): Database session.
        user_in (UserRegister): User registration data.
    Returns:
        UserPublic: The public representation of the newly created user.
    Raises:
        EmailAlreadyExists: If a user with the given email already exists.
        AppError: If there is an error during user creation.
    """
    user_create = UserCreate.model_validate(user_in)
    try:
        user = users_crud.create_user(
            session=session,
            user_create=user_create,
        )
        select_all_cinemas(
            session=session,
            user_id=user.id,
        )
        session.commit()
    except IntegrityError as e:
        session.rollback()
        if isinstance(e.orig, UniqueViolation):
            raise EmailAlreadyExists(user_in.email) from e
        else:
            raise AppError from e
    except Exception as e:
        session.rollback()
        raise AppError from e

    user_public = user_converters.to_public(user)
    return user_public
