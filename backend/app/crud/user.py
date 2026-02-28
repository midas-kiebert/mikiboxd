from datetime import datetime, time, timedelta
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.sql.elements import ColumnElement
from sqlmodel import Session, Time, case, cast, col, delete, or_, select

from app.core.enums import GoingStatus
from app.core.security import get_password_hash, verify_password
from app.crud import showtime_visibility as showtime_visibility_crud
from app.inputs.movie import Filters
from app.models.cinema_selection import CinemaSelection
from app.models.friendship import FriendRequest, Friendship
from app.models.letterboxd import Letterboxd
from app.models.movie import Movie
from app.models.showtime import Showtime
from app.models.showtime_selection import ShowtimeSelection
from app.models.user import User, UserCreate, UserUpdate
from app.models.watchlist_selection import WatchlistSelection

DAY_BUCKET_CUTOFF = time(4, 0)


def normalize_letterboxd_username(letterboxd_username: str) -> str:
    return letterboxd_username.strip().lower()


def time_range_clause(
    start_datetime_column,
    end_datetime_column,
    start: time | None,
    end: time | None,
) -> ColumnElement[bool]:
    def _single_time_col_clause(time_col) -> ColumnElement[bool]:
        if start is None and end is None:
            return time_col.is_not(None)
        if start is None:
            return time_col <= end
        if end is None:
            # Open-ended "start-" ranges are bounded by the day-bucket cutoff (04:00).
            if start <= DAY_BUCKET_CUTOFF:
                return time_col.between(start, DAY_BUCKET_CUTOFF)
            return or_(
                time_col >= start,
                time_col <= DAY_BUCKET_CUTOFF,
            )
        if start <= end:
            return time_col.between(start, end)

        # crosses midnight
        return or_(
            time_col >= start,
            time_col <= end,
        )

    start_time_col = cast(start_datetime_column, Time)
    start_clause = _single_time_col_clause(start_time_col)

    # When a range has an explicit end, the showtime's end must also fit that window.
    if end is not None:
        end_time_col = cast(func.coalesce(end_datetime_column, start_datetime_column), Time)
        end_clause = _single_time_col_clause(end_time_col)
        return start_clause & end_clause

    return start_clause


def day_bucket_date_clause(datetime_column):
    # Shift by 4 hours so 00:00-03:59 belongs to previous calendar day for filtering.
    return func.date(datetime_column - timedelta(hours=4))


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


def get_users_by_ids(*, session: Session, user_ids: list[UUID]) -> list[User]:
    if not user_ids:
        return []
    stmt = select(User).where(col(User.id).in_(user_ids))
    return list(session.exec(stmt).all())


def get_letterboxd_username(
    *,
    session: Session,
    user_id: UUID,
) -> str | None:
    """
    Get the Letterboxd username for a user.

    Parameters:
        session (Session): The database session.
        user_id (UUID): The ID of the user.
    Returns:
        str | None: The Letterboxd username if it exists, otherwise None.
    """
    user = get_user_by_id(session=session, user_id=user_id)
    if not user or not user.letterboxd or not user.letterboxd.letterboxd_username:
        return None
    return user.letterboxd.letterboxd_username


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


def get_user_by_display_name(*, session: Session, display_name: str) -> User | None:
    normalized_display_name = display_name.strip()
    if not normalized_display_name:
        return None
    statement = select(User).where(
        func.lower(col(User.display_name)) == normalized_display_name.lower()
    )
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


def create_letterboxd(
    *,
    session: Session,
    letterboxd_username: str,
    last_watchlist_sync: datetime | None = None,
):
    """
    Create a Letterboxd entry for a user.

    Parameters:
        session (Session): The database session.
        letterboxd_username (str): The Letterboxd username.
        last_watchlist_sync (datetime | None): The last time the watchlist was synced.
    Returns:
        User: The user object with the Letterboxd entry created.
    Raises:
        IntegrityError: If a Letterboxd entry with the same username already exists.
    """

    normalized_letterboxd_username = normalize_letterboxd_username(letterboxd_username)

    letterboxd = Letterboxd(
        letterboxd_username=normalized_letterboxd_username,
        last_watchlist_sync=last_watchlist_sync,
    )
    session.add(letterboxd)
    session.flush()  # Check for unique constraints
    return letterboxd


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
    if "letterboxd_username" in user_data:
        letterboxd_username = user_data["letterboxd_username"]
        if letterboxd_username:
            normalized_letterboxd_username = normalize_letterboxd_username(
                letterboxd_username
            )
            letterboxd = session.get(Letterboxd, normalized_letterboxd_username)
            if not letterboxd:
                letterboxd = create_letterboxd(
                    session=session,
                    letterboxd_username=normalized_letterboxd_username,
                )
            db_user.letterboxd = letterboxd
            user_data["letterboxd_username"] = normalized_letterboxd_username
        else:
            user_data["letterboxd_username"] = None
            db_user.letterboxd = None
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
    viewer_id: UUID | None,
    limit: int,
    offset: int,
    filters: Filters,
    letterboxd_username: str | None = None,
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
            Showtime.datetime >= filters.snapshot_time,
        )
    )

    if viewer_id is not None and viewer_id != user_id:
        stmt = stmt.where(
            showtime_visibility_crud.is_showtime_visible_to_viewer(
                owner_id_value=user_id,
                showtime_id_value=col(Showtime.id),
                viewer_id_value=viewer_id,
            )
        )

    if filters.selected_statuses is not None and len(filters.selected_statuses) > 0:
        stmt = stmt.where(
            col(ShowtimeSelection.going_status).in_(filters.selected_statuses)
        )

    if filters.selected_cinema_ids is not None and len(filters.selected_cinema_ids) > 0:
        stmt = stmt.where(col(Showtime.cinema_id).in_(filters.selected_cinema_ids))

    if filters.days is not None and len(filters.days) > 0:
        stmt = stmt.where(
            day_bucket_date_clause(col(Showtime.datetime)).in_(filters.days)
        )

    if filters.time_ranges is not None and len(filters.time_ranges) > 0:
        stmt = stmt.where(
            or_(
                *[
                    time_range_clause(
                        col(Showtime.datetime),
                        col(Showtime.end_datetime),
                        tr.start,
                        tr.end,
                    )
                    for tr in filters.time_ranges
                ]
            )
        )

    if filters.query or filters.watchlist_only:
        stmt = stmt.join(Movie, col(Movie.id) == col(Showtime.movie_id))

    if filters.query:
        pattern = f"%{filters.query}%"
        stmt = stmt.where(
            col(Movie.title).ilike(pattern) | col(Movie.original_title).ilike(pattern)
        )

    if filters.watchlist_only:
        if letterboxd_username is None:
            return []
        stmt = stmt.join(
            WatchlistSelection,
            col(WatchlistSelection.movie_id) == col(Showtime.movie_id),
        ).where(col(WatchlistSelection.letterboxd_username) == letterboxd_username)

    stmt = stmt.order_by(col(Showtime.datetime)).limit(limit).offset(offset)
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


def get_showtime_going_status(
    *, session: Session, showtime_id: int, user_id: UUID
) -> GoingStatus:
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
    selection = session.exec(stmt).one_or_none()
    return selection.going_status if selection else GoingStatus.NOT_GOING


def is_user_going_to_movie(
    *,
    session: Session,
    movie_id: int,
    user_id: UUID,
    snapshot_time: datetime,
) -> GoingStatus:
    """
    Check if a user is going to a movie by checking their future showtime selections.

    Parameters:
        session (Session): The database session.
        movie_id (int): The ID of the movie to check.
        user_id (UUID): The ID of the user to check.
        snapshot_time (datetime): The time to consider for the showtime selections.
    """
    stmt = (
        select(ShowtimeSelection)
        .join(Showtime, col(ShowtimeSelection.showtime_id) == col(Showtime.id))
        .where(
            col(ShowtimeSelection.user_id) == user_id,
            col(Showtime.movie_id) == movie_id,
            col(Showtime.datetime) >= snapshot_time,
        )
        .order_by(
            case(
                (ShowtimeSelection.going_status == GoingStatus.GOING, 0),
                (ShowtimeSelection.going_status == GoingStatus.INTERESTED, 1),
            )
        )
        .limit(1)
    )
    result = session.exec(stmt).one_or_none()

    if result is None:
        return GoingStatus.NOT_GOING

    return result.going_status


def get_selected_cinemas_ids(
    *,
    session: Session,
    user_id: UUID,
) -> list[int]:
    """
    Get a list of cinema IDs that a user has selected.

    Parameters:
        session (Session): The database session.
        user_id (UUID): The ID of the user whose selected cinemas are to be retrieved.
        limit (int): The maximum number of cinema IDs to return.
        offset (int): The offset for pagination.
    Returns:
        list[int]: A list of cinema IDs that the user has selected.
    """
    stmt = select(CinemaSelection.cinema_id).where(CinemaSelection.user_id == user_id)
    cinema_ids = list(session.exec(stmt).all())
    return cinema_ids


def set_cinema_selections(
    *,
    session: Session,
    user_id: UUID,
    cinema_ids: list[int],
) -> None:
    """
    Set the cinema selections for a user.

    Parameters:
        session (Session): The database session.
        user_id (UUID): The ID of the user whose cinema selections are to be set.
        cinema_ids (list[int]): A list of cinema IDs to select.
    Raises:
        IntegrityError: If there is a database integrity error, such as an invalid cinema_id.
    """
    # Clear existing selections
    stmt = delete(CinemaSelection).where(col(CinemaSelection.user_id) == user_id)
    session.execute(stmt)

    session.add_all(
        CinemaSelection(user_id=user_id, cinema_id=cinema_id)
        for cinema_id in cinema_ids
    )

    session.flush()
