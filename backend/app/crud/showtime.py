from datetime import time, timedelta
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.sql.elements import ColumnElement
from sqlmodel import Session, Time, cast, col, or_, select

from app.core.enums import GoingStatus
from app.inputs.movie import Filters
from app.models.friendship import Friendship
from app.models.movie import Movie
from app.models.showtime import Showtime, ShowtimeCreate
from app.models.showtime_selection import ShowtimeSelection
from app.models.user import User
from app.models.watchlist_selection import WatchlistSelection


def time_range_clause(
    datetime_column,
    start: time,
    end: time,
) -> ColumnElement[bool]:
    time_col = cast(datetime_column, Time)

    if start <= end:
        return time_col.between(start, end)

    # crosses midnight
    return or_(
        time_col >= start,
        time_col <= end,
    )


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
    stmt = select(Showtime).where(
        Showtime.movie_id == showtime_create.movie_id,
        Showtime.cinema_id == showtime_create.cinema_id,
        Showtime.ticket_link == showtime_create.ticket_link,
        col(Showtime.datetime).between(time_window_start, time_window_end),
        Showtime.datetime != showtime_create.datetime,
    )

    result = session.execute(stmt)
    return result.scalars().first()


def get_showtime_by_unique_fields(
    *,
    session: Session,
    movie_id: int,
    cinema_id: int,
    datetime,
) -> Showtime | None:
    stmt = select(Showtime).where(
        Showtime.movie_id == movie_id,
        Showtime.cinema_id == cinema_id,
        Showtime.datetime == datetime,
    )
    return session.execute(stmt).scalars().one_or_none()


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
    going_status: GoingStatus = GoingStatus.GOING,
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
            ShowtimeSelection.going_status == going_status,
        )
    )
    result = session.execute(stmt)
    friends: list[User] = list(result.scalars().all())
    return friends


def get_friends_with_showtime_selection(
    *,
    session: Session,
    showtime_id: int,
    friend_id: UUID,
    statuses: list[GoingStatus],
) -> list[User]:
    friends_subq = select(Friendship.user_id).where(Friendship.friend_id == friend_id)
    stmt = (
        select(User)
        .join(ShowtimeSelection, col(ShowtimeSelection.user_id) == User.id)
        .where(
            col(User.id).in_(friends_subq),
            ShowtimeSelection.showtime_id == showtime_id,
            col(ShowtimeSelection.going_status).in_(statuses),
        )
    )
    return list(session.exec(stmt).all())


def get_main_page_showtimes(
    *,
    session: Session,
    user_id: UUID,
    limit: int,
    offset: int,
    filters: Filters,
    letterboxd_username: str | None = None,
) -> list[Showtime]:
    stmt = select(Showtime).where(Showtime.datetime >= filters.snapshot_time)

    if filters.selected_cinema_ids is not None and len(filters.selected_cinema_ids) > 0:
        stmt = stmt.where(col(Showtime.cinema_id).in_(filters.selected_cinema_ids))

    if filters.days is not None and len(filters.days) > 0:
        stmt = stmt.where(func.date(col(Showtime.datetime)).in_(filters.days))

    if filters.time_ranges is not None and len(filters.time_ranges) > 0:
        stmt = stmt.where(
            or_(
                *[
                    time_range_clause(col(Showtime.datetime), tr.start, tr.end)
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

    if filters.selected_statuses is not None and len(filters.selected_statuses) > 0:
        friends_subq = select(Friendship.friend_id).where(Friendship.user_id == user_id)
        stmt = (
            stmt.join(
                ShowtimeSelection,
                col(Showtime.id) == col(ShowtimeSelection.showtime_id),
            )
            .where(
                or_(
                    col(ShowtimeSelection.user_id).in_(friends_subq),
                    ShowtimeSelection.user_id == user_id,
                ),
                col(ShowtimeSelection.going_status).in_(filters.selected_statuses),
            )
            .distinct()
        )

    stmt = stmt.order_by(col(Showtime.datetime)).limit(limit).offset(offset)
    showtimes = list(session.exec(stmt).all())
    return showtimes


def add_showtime_selection(
    *,
    session: Session,
    showtime_id: int,
    user_id: UUID,
    going_status: GoingStatus,
) -> Showtime:
    showtime = session.exec(select(Showtime).where(Showtime.id == showtime_id)).one()

    showtime_selection = session.get(
        ShowtimeSelection,
        (user_id, showtime_id),
    )
    if showtime_selection is not None:
        showtime_selection.going_status = going_status
        session.add(showtime_selection)
        session.flush()
        return showtime

    db_obj = ShowtimeSelection(
        user_id=user_id,
        showtime_id=showtime_id,
        going_status=going_status,
    )
    session.add(db_obj)
    session.flush()  # So that the ID is set, and check for integrity errors
    return showtime


def remove_showtime_selection(
    *,
    session: Session,
    showtime_id: int,
    user_id: UUID,
) -> Showtime:
    showtime = session.exec(select(Showtime).where(Showtime.id == showtime_id)).one()

    showtime_selection = session.get(
        ShowtimeSelection,
        (user_id, showtime_id),
    )
    if showtime_selection is not None:
        session.delete(showtime_selection)
        session.flush()

    return showtime
