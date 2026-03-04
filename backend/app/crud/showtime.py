from collections.abc import Sequence
from datetime import datetime, time, timedelta
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import aliased
from sqlalchemy.sql.elements import ColumnElement
from sqlmodel import Session, Time, cast, col, or_, select

from app.core.enums import GoingStatus
from app.crud import showtime_visibility as showtime_visibility_crud
from app.inputs.movie import Filters
from app.models.friendship import Friendship
from app.models.movie import Movie
from app.models.showtime import Showtime, ShowtimeCreate
from app.models.showtime_selection import ShowtimeSelection
from app.models.showtime_visibility import ShowtimeVisibilityEffective
from app.models.user import User
from app.models.watchlist_selection import WatchlistSelection
from app.utils import now_amsterdam_naive

DAY_BUCKET_CUTOFF = time(4, 0)
DAY_BUCKET_OFFSET = timedelta(
    hours=DAY_BUCKET_CUTOFF.hour,
    minutes=DAY_BUCKET_CUTOFF.minute,
    seconds=DAY_BUCKET_CUTOFF.second,
)


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
            end_time = end
            assert end_time is not None
            # Open-ended "-end" ranges start at the configured day-bucket cutoff.
            if end_time >= DAY_BUCKET_CUTOFF:
                return time_col.between(DAY_BUCKET_CUTOFF, end_time)
            return or_(
                time_col >= DAY_BUCKET_CUTOFF,
                time_col <= end_time,
            )
        if end is None:
            start_time = start
            assert start_time is not None
            # Open-ended "start-" ranges are bounded by the day-bucket cutoff (04:00).
            if start_time <= DAY_BUCKET_CUTOFF:
                return time_col.between(start_time, DAY_BUCKET_CUTOFF)
            return or_(
                time_col >= start_time,
                time_col <= DAY_BUCKET_CUTOFF,
            )
        start_time = start
        end_time = end
        assert start_time is not None
        assert end_time is not None
        if start_time <= end_time:
            return time_col.between(start_time, end_time)

        # crosses midnight
        return or_(
            time_col >= start_time,
            time_col <= end_time,
        )

    start_time_col = cast(start_datetime_column, Time)
    start_clause = _single_time_col_clause(start_time_col)

    # When a range has an explicit end, the showtime's end must also fit that window.
    if end is not None:
        end_time_col = cast(
            func.coalesce(end_datetime_column, start_datetime_column), Time
        )
        end_clause = _single_time_col_clause(end_time_col)
        return start_clause & end_clause

    return start_clause


def day_bucket_date_clause(datetime_column):
    # Shift by the configured day-bucket cutoff so post-midnight slots stay on the prior day.
    return func.date(datetime_column - DAY_BUCKET_OFFSET)


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


def get_showtimes_by_ids(
    *,
    session: Session,
    showtime_ids: Sequence[int],
) -> dict[int, Showtime]:
    if len(showtime_ids) == 0:
        return {}

    stmt = select(Showtime).where(col(Showtime.id).in_(showtime_ids))
    showtimes = list(session.exec(stmt).all())
    return {showtime.id: showtime for showtime in showtimes}


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


def get_showtime_reassignment_candidate(
    *,
    session: Session,
    showtime_create: ShowtimeCreate,
    delta: timedelta = timedelta(minutes=60),
) -> Showtime | None:
    datetime = showtime_create.datetime
    time_window_start = datetime - delta
    time_window_end = datetime + delta
    stmt = select(Showtime).where(
        Showtime.cinema_id == showtime_create.cinema_id,
        col(Showtime.datetime).between(time_window_start, time_window_end),
        Showtime.movie_id != showtime_create.movie_id,
    )
    if showtime_create.ticket_link is None:
        stmt = stmt.where(col(Showtime.ticket_link).is_(None))
    else:
        stmt = stmt.where(Showtime.ticket_link == showtime_create.ticket_link)

    candidates = list(session.exec(stmt.limit(2)).all())
    if len(candidates) != 1:
        return None
    return candidates[0]


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
        .join(ShowtimeSelection, col(ShowtimeSelection.user_id) == User.id)
        .join(
            ShowtimeVisibilityEffective,
            (col(ShowtimeVisibilityEffective.owner_id) == col(User.id))
            & (
                col(ShowtimeVisibilityEffective.showtime_id)
                == col(ShowtimeSelection.showtime_id)
            )
            & (col(ShowtimeVisibilityEffective.viewer_id) == user_id),
        )
        .where(
            col(ShowtimeSelection.showtime_id) == showtime_id,
            col(ShowtimeSelection.going_status) == going_status,
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
    if len(statuses) == 0:
        return []

    unique_statuses = list(dict.fromkeys(statuses))
    stmt = (
        select(User)
        .join(ShowtimeSelection, col(ShowtimeSelection.user_id) == col(User.id))
        .join(
            Friendship,
            (col(Friendship.user_id) == friend_id)
            & (col(Friendship.friend_id) == col(User.id)),
        )
        .where(
            col(ShowtimeSelection.showtime_id) == showtime_id,
            col(ShowtimeSelection.going_status).in_(unique_statuses),
        )
    )
    return list(session.exec(stmt).all())


def get_interested_reminder_candidates(
    *,
    session: Session,
    now: datetime,
    reminder_horizon: timedelta = timedelta(hours=24),
    minimum_notice: timedelta = timedelta(hours=2),
    minimum_delay_after_selection: timedelta = timedelta(hours=2),
    limit: int = 1000,
) -> list[tuple[ShowtimeSelection, Showtime]]:
    """
    Return interested selections eligible for a reminder notification.
    """
    earliest_showtime = now + minimum_notice
    latest_showtime = now + reminder_horizon
    latest_selection_update = now - minimum_delay_after_selection

    stmt = (
        select(ShowtimeSelection, Showtime)
        .join(Showtime, col(ShowtimeSelection.showtime_id) == col(Showtime.id))
        .where(
            ShowtimeSelection.going_status == GoingStatus.INTERESTED,
            col(ShowtimeSelection.interested_reminder_sent_at).is_(None),
            col(ShowtimeSelection.updated_at) <= latest_selection_update,
            col(Showtime.datetime) >= earliest_showtime,
            col(Showtime.datetime) <= latest_showtime,
        )
        .order_by(col(Showtime.datetime).asc())
        .limit(limit)
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

    if (
        filters.query
        or filters.watchlist_only
        or filters.runtime_min is not None
        or filters.runtime_max is not None
    ):
        stmt = stmt.join(Movie, col(Movie.id) == col(Showtime.movie_id))

    if filters.query:
        pattern = f"%{filters.query}%"
        stmt = stmt.where(
            col(Movie.title).ilike(pattern) | col(Movie.original_title).ilike(pattern)
        )

    if filters.runtime_min is not None:
        stmt = stmt.where(col(Movie.duration) >= filters.runtime_min)

    if filters.runtime_max is not None:
        stmt = stmt.where(col(Movie.duration) <= filters.runtime_max)

    if filters.watchlist_only:
        if letterboxd_username is None:
            return []
        stmt = stmt.join(
            WatchlistSelection,
            col(WatchlistSelection.movie_id) == col(Showtime.movie_id),
        ).where(col(WatchlistSelection.letterboxd_username) == letterboxd_username)

    if filters.selected_statuses is not None and len(filters.selected_statuses) > 0:
        visible_row = aliased(ShowtimeVisibilityEffective)
        stmt = (
            stmt.join(
                ShowtimeSelection,
                col(Showtime.id) == col(ShowtimeSelection.showtime_id),
            )
            .outerjoin(
                visible_row,
                (col(visible_row.owner_id) == col(ShowtimeSelection.user_id))
                & (col(visible_row.showtime_id) == col(Showtime.id))
                & (col(visible_row.viewer_id) == user_id),
            )
            .where(
                or_(
                    col(ShowtimeSelection.user_id) == user_id,
                    col(visible_row.viewer_id).is_not(None),
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
    seat_row: str | None = None,
    seat_number: str | None = None,
    update_seat: bool = False,
) -> Showtime:
    now = now_amsterdam_naive()
    showtime = session.exec(select(Showtime).where(Showtime.id == showtime_id)).one()

    showtime_selection = session.get(
        ShowtimeSelection,
        (user_id, showtime_id),
    )

    next_seat_row = seat_row if going_status == GoingStatus.GOING else None
    next_seat_number = seat_number if going_status == GoingStatus.GOING else None

    if showtime_selection is not None:
        has_changes = False

        if showtime_selection.going_status != going_status:
            showtime_selection.going_status = going_status
            showtime_selection.interested_reminder_sent_at = None
            has_changes = True

        if going_status != GoingStatus.GOING:
            if showtime_selection.seat_row is not None:
                showtime_selection.seat_row = None
                has_changes = True
            if showtime_selection.seat_number is not None:
                showtime_selection.seat_number = None
                has_changes = True
        elif update_seat:
            if showtime_selection.seat_row != next_seat_row:
                showtime_selection.seat_row = next_seat_row
                has_changes = True
            if showtime_selection.seat_number != next_seat_number:
                showtime_selection.seat_number = next_seat_number
                has_changes = True

        if has_changes:
            showtime_selection.updated_at = now
            session.add(showtime_selection)
            session.flush()
        showtime_visibility_crud.rebuild_effective_visibility_for_showtime(
            session=session,
            owner_id=user_id,
            showtime_id=showtime_id,
        )
        return showtime

    db_obj = ShowtimeSelection(
        user_id=user_id,
        showtime_id=showtime_id,
        going_status=going_status,
        seat_row=next_seat_row if update_seat else None,
        seat_number=next_seat_number if update_seat else None,
        created_at=now,
        updated_at=now,
    )
    session.add(db_obj)
    session.flush()  # So that the ID is set, and check for integrity errors
    showtime_visibility_crud.rebuild_effective_visibility_for_showtime(
        session=session,
        owner_id=user_id,
        showtime_id=showtime_id,
    )
    return showtime


def get_showtime_selection(
    *,
    session: Session,
    showtime_id: int,
    user_id: UUID,
) -> ShowtimeSelection | None:
    return session.get(ShowtimeSelection, (user_id, showtime_id))


def get_showtime_selections_for_users(
    *,
    session: Session,
    showtime_id: int,
    user_ids: Sequence[UUID],
) -> dict[UUID, ShowtimeSelection]:
    if len(user_ids) == 0:
        return {}

    stmt = select(ShowtimeSelection).where(
        ShowtimeSelection.showtime_id == showtime_id,
        col(ShowtimeSelection.user_id).in_(user_ids),
    )
    selections = list(session.exec(stmt).all())
    return {selection.user_id: selection for selection in selections}


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

    showtime_visibility_crud.rebuild_effective_visibility_for_showtime(
        session=session,
        owner_id=user_id,
        showtime_id=showtime_id,
    )

    return showtime
