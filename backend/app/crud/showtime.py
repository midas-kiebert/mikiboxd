from datetime import datetime, timedelta
from uuid import UUID

from sqlmodel import Session, col, or_, select

from app.models.friendship import Friendship
from app.models.showtime import Showtime, ShowtimeCreate
from app.models.showtime_selection import ShowtimeSelection
from app.models.user import User


def get_showtime_by_id(
    *,
    session: Session,
    showtime_id: int,
) -> Showtime | None:
    """
    Get a showtime by its ID.

    Parameters:
        session (Session): The SQLAlchemy session to use.
        showtime_id (int): The ID of the showtime to retrieve.
    Returns:
        Showtime | None: The Showtime object if found, otherwise None.
    """
    return session.get(Showtime, showtime_id)


def get_showtime_close_in_time(
    *,
    session: Session,
    showtime_create: ShowtimeCreate,
    delta: timedelta = timedelta(minutes=60),
) -> Showtime | None:
    datetime = showtime_create.datetime

    time_window_start = datetime - delta
    time_window_end = datetime + delta
    stmt = (
        select(Showtime)
        .where(
            Showtime.movie_id == showtime_create.movie_id,
            Showtime.cinema_id == showtime_create.cinema_id,
            col(Showtime.datetime).between(time_window_start, time_window_end),
            Showtime.datetime != showtime_create.datetime,
        )
    )

    result = session.execute(stmt)
    return result.scalars().first()



def create_showtime(
    *,
    session: Session,
    showtime_create: ShowtimeCreate,
) -> Showtime:
    """
    Create a new showtime in the database. Raises an IntegrityError if the
    showtime with that id already exists. Also raises an IntegrityError if the
    movie or cinema does not exist.

    Parameters:
        session (Session): The SQLAlchemy session to use.
        showtime_create (ShowtimeCreate): The data for creating the showtime.
    Returns:
        Showtime: The created Showtime object.
    Raises:
        IntegrityError: If a showtime with the same ID already exists or if the
        movie or cinema does not exist.
    """
    db_obj = Showtime(**showtime_create.model_dump())
    session.add(db_obj)
    session.flush()  # So that the ID is set, and check for integrity errors
    return db_obj


def get_friends_for_showtime(
    *,
    session: Session,
    showtime_id: int,
    user_id: UUID,
) -> list[User]:
    """
    Get a list of friends who have selected a specific showtime.

    Parameters:
        session (Session): The SQLAlchemy session to use.
        showtime_id (int): The ID of the showtime.
        user_id (UUID): The ID of the user whose friends are being queried.
    Returns:
        list[User]: A list of User objects representing friends who have selected the showtime.
    """
    stmt = (
        select(User)
        .join(Friendship, col(Friendship.friend_id) == User.id)
        .join(ShowtimeSelection, col(ShowtimeSelection.user_id) == User.id)
        .where(
            Friendship.user_id == user_id,
            ShowtimeSelection.showtime_id == showtime_id,
        )
    )
    result = session.execute(stmt)
    friends: list[User] = list(result.scalars().all())
    return friends


def get_main_page_showtimes(
    *,
    session: Session,
    user_id: UUID,
    snapshot_time: datetime,
    limit: int,
    offset: int,
) -> list[Showtime]:
    """
    Get a list of showtimes that a user and their friends have selected.

    Parameters:
        session (Session): The database session.
        user_id (UUID): The ID of the user.
    Returns:
        list[Showtime]
    """
    friends_subq = select(Friendship.friend_id).where(Friendship.user_id == user_id)

    stmt = (
        select(Showtime)
        .join(
            ShowtimeSelection,
            col(Showtime.id) == ShowtimeSelection.showtime_id,
        )
        .where(
            or_(
                col(ShowtimeSelection.user_id).in_(friends_subq),
                ShowtimeSelection.user_id == user_id,
            ),
            Showtime.datetime >= snapshot_time,
        )
        .order_by(col(Showtime.datetime))
        .limit(limit)
        .offset(offset)
    )
    showtimes = list(session.exec(stmt).all())
    return showtimes
