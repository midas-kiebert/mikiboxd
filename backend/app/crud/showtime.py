from uuid import UUID

from sqlmodel import Session, col, select

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
