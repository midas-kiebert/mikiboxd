from datetime import datetime
from uuid import UUID

from sqlmodel import Session, col, select

from app.core.security import get_password_hash, verify_password
from app.models.friendship import FriendRequest, Friendship
from app.models.showtime import Showtime
from app.models.showtime_selection import ShowtimeSelection
from app.models.user import User, UserCreate, UserUpdate
from app.utils import now_amsterdam_naive


def get_user_by_id(*, session: Session, user_id: UUID) -> User | None:
    """
    Get a user by their ID.

    Parameters:
        session (Session): The database session.
        user_id (UUID): The ID of the user to retrieve.
    Returns:
        User | None: The user object if found, otherwise None.
    """
    return session.get(User, user_id)


def get_user_by_email(*, session: Session, email: str) -> User | None:
    """
    Get a user by their email address.

    Parameters:
        session (Session): The database session.
        email (str): The email address of the user to retrieve.
    Returns:
        User | None: The user object if found, otherwise None.
    """
    statement = select(User).where(User.email == email)
    session_user = session.exec(statement).one_or_none()
    return session_user


def create_user(
    *,
    session: Session,
    user_create: UserCreate,
) -> User:
    """
    Create a new user in the database.
    Parameters:
        session (Session): The database session.
        user_create (UserCreate): The user creation data.
    Returns:
        User: The created user object.
    Raises:
        IntegrityError: If a user with the same email already exists.
    """
    db_obj = User.model_validate(
        user_create, update={"hashed_password": get_password_hash(user_create.password)}
    )
    session.add(db_obj)
    session.flush()  # Check for unique constraints
    return db_obj


def update_user(
    *,
    session: Session,
    db_user: User,
    user_in: UserUpdate,
) -> User:
    """
    Update an existing user in the database.
    Parameters:
        db_user (User): The user object to update.
        user_in (UserUpdate): The user update data.
    Returns:
        User: The updated user object.
    Raises:
        IntegrityError: If a user with the same email already exists.
    """
    user_data = user_in.model_dump(exclude_unset=True)
    extra_data = {}
    if "password" in user_data:
        password = user_data["password"]
        hashed_password = get_password_hash(password)
        extra_data["hashed_password"] = hashed_password
    db_user.sqlmodel_update(user_data, update=extra_data)
    session.flush()  # Check for unique constraints
    return db_user


def authenticate(*, session: Session, email: str, password: str) -> User | None:
    """
    Authenticate a user by email and password.

    Parameters:
        session (Session): The database session.
        email (str): The email address of the user.
        password (str): The password of the user.
    Returns:
        User | None: The authenticated user object if credentials are valid, otherwise None.
    """
    db_user = get_user_by_email(session=session, email=email)
    if not db_user:
        return None
    if not verify_password(password, db_user.hashed_password):
        return None
    return db_user


def get_users(
    *,
    session: Session,
    query: str,
    limit: int,
    offset: int,
    current_user_id: UUID,
) -> list[User]:
    """
    Get a list of users based on a search query, excluding the current user.

    Parameters:
        session (Session): The database session.
        query (str): The search query for user display names.
        limit (int): The maximum number of users to return.
        offset (int): The offset for pagination.
        current_user_id (UUID): The ID of the current user to exclude from results.
    Returns:
        list[User]: A list of User objects matching the search criteria.
    """
    stmt = select(User).where(col(User.display_name).isnot(None))
    if query:
        stmt = stmt.where(col(User.display_name).ilike(f"%{query}%"))
    stmt = stmt.where(col(User.id) != current_user_id).limit(limit).offset(offset)

    users: list[User] = list(session.exec(stmt).all())
    return users


def get_friends(*, session: Session, user_id: UUID) -> list[User]:
    """
    Get a list of friends for a user.

    Parameters:
        session (Session): The database session.
        user_id (UUID): The ID of the user whose friends are to be retrieved.
    Returns:
        list[User]: A list of User objects representing the user's friends.
    """
    stmt = (
        select(User)
        .join(
            Friendship,
            col(Friendship.friend_id) == User.id,
        )
        .where(Friendship.user_id == user_id)
    )
    friends: list[User] = list(session.exec(stmt).all())
    return friends


def get_selected_showtimes(
    *,
    session: Session,
    user_id: UUID,
    snapshot_time: datetime = now_amsterdam_naive(),
) -> list[Showtime]:
    """
    Get a list of showtimes that a user has selected.

    Parameters:
        session (Session): The database session.
        user_id (UUID): The ID of the user whose selected showtimes are to be retrieved.
    Returns:
        list[Showtime]: A list of Showtime objects that the user has selected.
    """
    stmt = (
        select(Showtime)
        .join(
            ShowtimeSelection,
            col(Showtime.id) == ShowtimeSelection.showtime_id,
        )
        .where(
            ShowtimeSelection.user_id == user_id,
            Showtime.datetime >= snapshot_time,
        )
        .order_by(col(Showtime.datetime))
    )
    showtimes = list(session.exec(stmt).all())
    return showtimes


def get_sent_friend_requests(*, session: Session, user_id: UUID) -> list[User]:
    """
    Get a list of users to whom the specified user has sent friend requests.

    Parameters:
        session (Session): The database session.
        user_id (UUID): The ID of the user whose sent friend requests are to be retrieved.
    Returns:
        list[User]: A list of User objects representing the users who received friend requests from the specified user.
    """
    stmt = (
        select(User)
        .join(
            FriendRequest,
            col(FriendRequest.receiver_id) == col(User.id),
        )
        .where(FriendRequest.sender_id == user_id)
    )
    users: list[User] = list(session.exec(stmt).all())
    return users


def get_received_friend_requests(*, session: Session, user_id: UUID) -> list[User]:
    """
    Get a list of users who have sent friend requests to the specified user.

    Parameters:
        session (Session): The database session.
        user_id (UUID): The ID of the user whose received friend requests are to be retrieved.
    Returns:
        list[User]: A list of User objects representing the users who sent friend requests to the specified user.
    """
    stmt = (
        select(User)
        .join(
            FriendRequest,
            col(FriendRequest.sender_id) == col(User.id),
        )
        .where(FriendRequest.receiver_id == user_id)
    )
    users: list[User] = list(session.exec(stmt).all())
    return users


def add_showtime_selection(
    *,
    session: Session,
    user_id: UUID,
    showtime_id: int,
) -> Showtime:
    """
    Add a selection for a showtime by a user.

    Parameters:
        session (Session): The database session.
        user_id (UUID): The ID of the user making the selection.
        showtime_id (int): The ID of the showtime to select.
    Returns:
        Showtime: The showtime object if the selection was added successfully.
    Raises:
        IntegrityError: If the selection already exists for the user and showtime
        or the showtime/user doesnt exist.
    """
    selection = ShowtimeSelection(user_id=user_id, showtime_id=showtime_id)
    session.add(selection)
    session.flush()

    stmt = select(Showtime).where(Showtime.id == showtime_id)
    showtime = session.exec(stmt).one()

    return showtime


def delete_showtime_selection(
    *,
    session: Session,
    user_id: UUID,
    showtime_id: int,
) -> Showtime:
    """
    Delete a user's selection for a specific showtime.

    Parameters:
        session (Session): The database session.
        user_id (UUID): The ID of the user whose selection is to be deleted.
        showtime_id (int): The ID of the showtime to delete the selection for.
    Returns:
        Showtime: The showtime object if the selection was deleted successfully.
    Raises:
        NoResultsFound: If the selection does not exist for the user and showtime.
        MultipleResultsFound: If multiple selections exist (should not happen in a well-formed database).
    """
    showtime_selection = session.exec(
        select(ShowtimeSelection).where(
            ShowtimeSelection.user_id == user_id,
            ShowtimeSelection.showtime_id == showtime_id,
        )
    ).one()
    showtime = session.exec(
        select(Showtime).where(Showtime.id == showtime_selection.showtime_id)
    ).one()

    session.delete(showtime_selection)
    return showtime


def has_user_selected_showtime(
    *, session: Session, showtime_id: int, user_id: UUID
) -> bool:
    """
    Check if a user has selected a specific showtime.

    Parameters:
        session (Session): The database session.
        showtime_id (int): The ID of the showtime to check.
        user_id (UUID): The ID of the user to check.
    Returns:
        bool: True if the user has selected the showtime, otherwise False.
    """
    stmt = select(ShowtimeSelection).where(
        ShowtimeSelection.showtime_id == showtime_id,
        ShowtimeSelection.user_id == user_id,
    )
    result = session.exec(stmt).one_or_none() is not None
    return result


def is_user_going_to_movie(
    *,
    session: Session,
    movie_id: int,
    user_id: UUID,
    snapshot_time: datetime = now_amsterdam_naive(),
) -> bool:
    """
    Check if a user is going to a movie by checking their future showtime selections.

    Parameters:
        session (Session): The database session.
        movie_id (int): The ID of the movie to check.
        user_id (UUID): The ID of the user to check.
        snapshot_time (datetime): The time to consider for the showtime selections.
    Returns:
        bool: True if the user has selected a showtime for the movie after the snapshot time,
              otherwise False.
    """
    stmt = (
        select(ShowtimeSelection)
        .join(Showtime, col(ShowtimeSelection.showtime_id) == col(Showtime.id))
        .where(
            col(ShowtimeSelection.user_id) == user_id,
            col(Showtime.movie_id) == movie_id,
            col(Showtime.datetime) >= snapshot_time,
        )
        .limit(1)
    )
    result = session.execute(stmt)
    return result.scalars().one_or_none() is not None
