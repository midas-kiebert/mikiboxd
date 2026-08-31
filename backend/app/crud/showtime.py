from collections.abc import Sequence
from datetime import datetime, time, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import Float, case, func, nulls_last
from sqlalchemy.orm import aliased
from sqlalchemy.sql.elements import ColumnElement
from sqlmodel import Session, Time, cast, col, or_, select

from app.core.enums import GoingStatus, SearchField, SeatAlertKind
from app.core.viewer import ViewerId
from app.crud import showtime_visibility as showtime_visibility_crud
from app.crud.movie import apply_language_filter, apply_search_filter
from app.crud.movie_set_filters import apply_movie_set_filters
from app.inputs.movie import Filters
from app.models.deleted_showtime import DeletedShowtime
from app.models.friendship import Friendship
from app.models.movie import Movie
from app.models.showtime import Showtime, ShowtimeCreate
from app.models.showtime_ping import ShowtimePing
from app.models.showtime_selection import ShowtimeSelection
from app.models.showtime_visibility import ShowtimeVisibilityEffective
from app.models.user import User
from app.utils import now_amsterdam_naive

# A selection someone has actively made. NOT_GOING rows survive as a record of
# a decision, and must not make a showtime look like anyone still cares about it.
ACTIVE_GOING_STATUSES = (GoingStatus.GOING, GoingStatus.INTERESTED)

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


def search_showtimes_for_admin(
    *,
    session: Session,
    cinema_id: int | None,
    movie_id: int | None,
    from_datetime: datetime | None,
    to_datetime: datetime | None,
    limit: int,
    offset: int,
) -> list[Showtime]:
    stmt = select(Showtime).order_by(col(Showtime.datetime).desc())
    if cinema_id is not None:
        stmt = stmt.where(Showtime.cinema_id == cinema_id)
    if movie_id is not None:
        stmt = stmt.where(Showtime.movie_id == movie_id)
    if from_datetime is not None:
        stmt = stmt.where(col(Showtime.datetime) >= from_datetime)
    if to_datetime is not None:
        stmt = stmt.where(col(Showtime.datetime) <= to_datetime)
    stmt = stmt.limit(limit).offset(offset)
    return list(session.exec(stmt).all())


def update_showtime(*, showtime: Showtime, update_data: dict[str, Any]) -> Showtime:
    showtime.sqlmodel_update(update_data)
    return showtime


def delete_showtime(*, session: Session, showtime: Showtime) -> None:
    """Hard-delete a showtime. Callers that want it to stay gone across future
    scrapes must also record a `DeletedShowtime` tombstone (see the admin
    reports-page delete endpoint) before calling this."""
    session.delete(showtime)


def tombstone_showtime(*, session: Session, showtime: Showtime) -> None:
    if is_showtime_tombstoned(
        session=session,
        movie_id=showtime.movie_id,
        cinema_id=showtime.cinema_id,
        datetime=showtime.datetime,
    ):
        return
    session.add(
        DeletedShowtime(
            movie_id=showtime.movie_id,
            cinema_id=showtime.cinema_id,
            datetime=showtime.datetime,
        )
    )
    session.flush()


def is_showtime_tombstoned(
    *,
    session: Session,
    movie_id: int,
    cinema_id: int,
    datetime,
) -> bool:
    stmt = select(DeletedShowtime.id).where(
        DeletedShowtime.movie_id == movie_id,
        DeletedShowtime.cinema_id == cinema_id,
        DeletedShowtime.datetime == datetime,
    )
    return session.execute(stmt).first() is not None


def get_showtimes_by_movie_id(*, session: Session, movie_id: int) -> list[Showtime]:
    return list(session.exec(select(Showtime).where(Showtime.movie_id == movie_id)))


def get_showtimes_by_movie_and_cache(
    *, session: Session, movie_id: int, cache_id: int
) -> list[Showtime]:
    return list(
        session.exec(
            select(Showtime).where(
                Showtime.movie_id == movie_id,
                Showtime.tmdb_cache_id == cache_id,
            )
        )
    )


def reassign_showtimes_movie(
    *, session: Session, old_movie_id: int, new_movie_id: int, cache_id: int
) -> int:
    """Move showtimes off `old_movie_id` onto `new_movie_id`.

    Scoped to showtimes whose `tmdb_cache_id` matches the cache entry being
    corrected — a different cache entry can resolve to the same movie_id
    (e.g. two cinemas' scrapers), and those showtimes are still correctly
    identified, so they must not be swept along.

    Reassigned one row at a time (not a single bulk UPDATE) since the
    (cinema_id, datetime, movie_id) unique constraint can already be
    satisfied by an existing `new_movie_id` showtime — such conflicting rows
    are left on the old id rather than aborting the whole correction.
    """
    reassigned = 0
    for showtime in get_showtimes_by_movie_and_cache(
        session=session, movie_id=old_movie_id, cache_id=cache_id
    ):
        conflict = session.exec(
            select(Showtime).where(
                Showtime.cinema_id == showtime.cinema_id,
                Showtime.datetime == showtime.datetime,
                Showtime.movie_id == new_movie_id,
            )
        ).first()
        if conflict is not None:
            continue
        showtime.movie_id = new_movie_id
        reassigned += 1
    session.flush()
    return reassigned


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


# Each seat notice keeps its own "already told them" stamp on the selection.
# Named here once so the candidate query and the simulation's reset can never
# disagree about which column guards which notice.
SEAT_ALERT_SENT_AT_FIELDS: dict[SeatAlertKind, str] = {
    SeatAlertKind.NEARLY_SOLD_OUT: "seat_alert_sent_at",
    SeatAlertKind.SOLD_OUT: "sold_out_alert_sent_at",
}


def clear_seat_alerts(*, session: Session, showtime_id: int) -> None:
    """Forget that anyone was told anything about this showtime's seat count.

    Both notices at once: the simulation hook this exists for replays a whole
    run up the scale, and half-cleared stamps would let it fire one notice and
    silently swallow the other.

    Only ever called by that superuser hook, which is refused in production —
    the whole point of the stamps is that nothing in the normal flow clears them.
    """
    fields = list(SEAT_ALERT_SENT_AT_FIELDS.values())
    selections = session.exec(
        select(ShowtimeSelection).where(
            ShowtimeSelection.showtime_id == showtime_id,
            or_(
                *(
                    col(getattr(ShowtimeSelection, field)).is_not(None)
                    for field in fields
                )
            ),
        )
    ).all()
    for selection in selections:
        for field in fields:
            setattr(selection, field, None)
        session.add(selection)


def get_seat_alert_candidates(
    *,
    session: Session,
    showtime_ids: Sequence[int],
    statuses: Sequence[GoingStatus],
    kind: SeatAlertKind,
) -> list[tuple[ShowtimeSelection, Showtime]]:
    """
    Selections that should be told these showtimes have crossed `kind`.

    Only ones never told before — the kind's stamp is the once-per-showtime
    guarantee, and it is checked here rather than left to the caller so no
    delivery path can skip it.
    """
    if len(showtime_ids) == 0:
        return []

    sent_at = getattr(ShowtimeSelection, SEAT_ALERT_SENT_AT_FIELDS[kind])
    stmt = (
        select(ShowtimeSelection, Showtime)
        .join(Showtime, col(ShowtimeSelection.showtime_id) == col(Showtime.id))
        .where(
            col(ShowtimeSelection.showtime_id).in_(showtime_ids),
            col(ShowtimeSelection.going_status).in_(statuses),
            col(sent_at).is_(None),
        )
    )
    return list(session.exec(stmt).all())


# --- Seat poller priority ---------------------------------------------------
#
# A due showtime's priority is how many of *its own* intervals it is overdue by,
# not how overdue it is in minutes. That one ratio does the work of several
# rules at once: a screening down to its last seats is on a quarter-hourly
# cadence, so it passes 1.0 four times an hour, while a far-off screening that
# nothing has happened to for days has backed off to a two-day interval and
# crawls towards 1.0 — exactly the one that can afford to be skipped. And a
# showtime passed over by the run caps keeps accumulating ratio until it wins,
# so nothing can be starved indefinitely by busier neighbours.
#
# The interval is recovered from the row rather than stored: `apply_reading`
# writes `seats_checked_at` and `seats_next_check_at` together, so the gap
# between them *is* the interval that was chosen for it.
_MIN_PRIORITY_INTERVAL_SECONDS = 60.0
# ...and a ceiling on it, so a showtime whose reads keep failing — those leave
# `seats_checked_at` untouched while pushing the due time out, inflating the
# apparent interval — still climbs back up the queue eventually instead of
# deprioritising itself forever.
_MAX_PRIORITY_INTERVAL_SECONDS = 48 * 60 * 60.0
# A count that moved on its last reading is worth more than one that did not.
# Something is actually happening to this screening; do not let it be skipped.
_ACTIVITY_PRIORITY_MULTIPLIER = 2.0


def _seat_priority_score(now: datetime) -> ColumnElement[float]:
    """How badly a due showtime wants reading, in units of its own interval."""
    interval_seconds = func.least(
        func.greatest(
            func.extract(
                "epoch",
                col(Showtime.seats_next_check_at) - col(Showtime.seats_checked_at),
            ),
            _MIN_PRIORITY_INTERVAL_SECONDS,
        ),
        _MAX_PRIORITY_INTERVAL_SECONDS,
    )
    # Column on the left of the subtraction on purpose: it gives the bound
    # parameter a type to infer from, which a bare `now - column` does not.
    lateness_seconds = -func.extract("epoch", col(Showtime.seats_next_check_at) - now)
    activity = case(
        (col(Showtime.seats_unchanged_streak) == 0, _ACTIVITY_PRIORITY_MULTIPLIER),
        else_=1.0,
    )
    return cast(lateness_seconds / interval_seconds * activity, Float)


def get_seat_availability_candidates(
    *,
    session: Session,
    now: datetime,
    limit: int,
) -> list[Showtime]:
    """
    Return showtimes whose seat availability is worth re-reading right now.

    Only showtimes at least one user has selected: every reading is a request
    at a real ticket shop, and the whole catalogue would be tens of thousands
    of them.

    The only bound on *when* is that the screening has not started. There is no
    far horizon — a screening months away with one seat left is the most urgent
    thing in the list, not the least — and no minimum notice either: somebody
    ten minutes from the cinema can still act on a seat, and excluding the last
    hour saved almost nothing. How often any of them comes up is already decided
    per showtime when its last reading was written down — see
    `services/seat_availability.next_check_at`. A null due time is a showtime
    that has never been read.

    The strict `>` is load-bearing: a sold-out screening is parked at its own
    start time, so "due" and "has not started" can never both be true for it.

    Priority, when a run cannot take everything that is due:

    1. Never read at all. Someone selected it and we have nothing to show them.
    2. Highest `_seat_priority_score` — how many of its own intervals it is
       overdue by, doubled if its count moved on the last reading. See the
       comment on that function for why one number covers urgency, activity and
       starvation at once.
    3. Fewest seats left, to break a tie between two screenings equally overdue
       on the same cadence. Nulls last: a platform that reports status without
       a number is not urgent, and would otherwise read as "no seats left".
    """
    stmt = (
        select(Showtime)
        .where(
            col(Showtime.datetime) > now,
            col(Showtime.ticket_link).is_not(None),
            or_(
                col(Showtime.seats_next_check_at).is_(None),
                col(Showtime.seats_next_check_at) <= now,
            ),
            col(Showtime.id).in_(
                select(col(ShowtimeSelection.showtime_id)).where(
                    col(ShowtimeSelection.going_status).in_(ACTIVE_GOING_STATUSES)
                )
            ),
        )
        .order_by(
            col(Showtime.seats_checked_at).is_(None).desc(),
            _seat_priority_score(now).desc(),
            nulls_last(col(Showtime.seats_left).asc()),
        )
        .limit(limit)
    )
    return list(session.exec(stmt).all())


def mark_seat_availability_due(
    *, session: Session, showtime_id: int, now: datetime
) -> None:
    """Bring `showtime_id`'s next seat reading forward to the poller's next run.

    Deliberately a due-time write and not a request: someone marking themselves
    interested must never be able to make the backend hit a ticket shop, or a
    user working through a long list would do exactly that dozens of times over.
    The poller picks this up within minutes, with every cap it has still applied.

    Only a showtime that has never been read at all is affected. It is marked
    due even though its due time is null, which is the case that makes the
    "checking..." state visible: null means "nobody has asked for this yet"
    everywhere it is read, so without this write a brand-new showtime would
    show nothing at all until its first reading landed, rather than saying a
    number was on its way. One that already has a reading, however old, is
    left on its own cadence — interest in it needs nothing rescued.
    """
    showtime = session.get(Showtime, showtime_id)
    if showtime is None or showtime.ticket_link is None:
        return
    if showtime.seats_checked_at is not None:
        return
    if showtime.seats_next_check_at is not None and showtime.seats_next_check_at <= now:
        return
    showtime.seats_next_check_at = now
    session.add(showtime)


def _build_main_page_showtimes_query(
    *,
    session: Session,
    user_id: ViewerId,
    filters: Filters,
    letterboxd_username: str | None,
) -> tuple[Any, bool]:
    """
    Shared filter-application logic for get_main_page_showtimes and
    count_main_page_showtimes. Every filter dimension must be applied here
    exactly once so the two entry points can never drift out of sync.
    """
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

    has_languages_filter = (
        filters.selected_languages is not None and len(filters.selected_languages) > 0
    )

    if (
        (filters.query and filters.search_field != SearchField.FRIEND)
        or filters.runtime_min is not None
        or filters.runtime_max is not None
        or has_languages_filter
    ):
        stmt = stmt.join(Movie, col(Movie.id) == col(Showtime.movie_id))

    stmt = apply_search_filter(
        stmt, filters=filters, session=session, current_user_id=user_id
    )

    if filters.runtime_min is not None:
        stmt = stmt.where(col(Movie.duration) >= filters.runtime_min)

    if filters.runtime_max is not None:
        stmt = stmt.where(col(Movie.duration) <= filters.runtime_max)

    if has_languages_filter:
        stmt = apply_language_filter(stmt, filters=filters)

    stmt, force_empty = apply_movie_set_filters(
        stmt,
        movie_id_col=col(Showtime.movie_id),
        filters=filters,
        letterboxd_username=letterboxd_username,
    )
    if force_empty:
        return stmt, True

    # "Going / interested" is a statement about people, so it needs someone to be
    # about. An anonymous viewer has no selections and can see no one else's, so
    # the filter is dropped rather than applied against a NULL viewer, which would
    # match nothing and leave them looking at an empty catalogue.
    if (
        user_id is not None
        and filters.selected_statuses is not None
        and len(filters.selected_statuses) > 0
    ):
        visible_row = aliased(ShowtimeVisibilityEffective)
        stmt = stmt.join(
            ShowtimeSelection,
            col(Showtime.id) == col(ShowtimeSelection.showtime_id),
        ).outerjoin(
            visible_row,
            (col(visible_row.owner_id) == col(ShowtimeSelection.user_id))
            & (col(visible_row.showtime_id) == col(Showtime.id))
            & (col(visible_row.viewer_id) == user_id),
        )
        # friends_only drops the viewer's own selections from the OR below,
        # leaving only rows made visible by someone else's selection.
        owner_clause = (
            col(visible_row.viewer_id).is_not(None)
            if filters.friends_only
            else or_(
                col(ShowtimeSelection.user_id) == user_id,
                col(visible_row.viewer_id).is_not(None),
            )
        )
        stmt = stmt.where(
            owner_clause,
            col(ShowtimeSelection.going_status).in_(filters.selected_statuses),
        ).distinct()

    return stmt, False


def get_main_page_showtimes(
    *,
    session: Session,
    user_id: ViewerId,
    limit: int,
    offset: int,
    filters: Filters,
    letterboxd_username: str | None = None,
) -> list[Showtime]:
    stmt, force_empty = _build_main_page_showtimes_query(
        session=session,
        user_id=user_id,
        filters=filters,
        letterboxd_username=letterboxd_username,
    )
    if force_empty:
        return []

    stmt = stmt.order_by(col(Showtime.datetime)).limit(limit).offset(offset)
    showtimes = list(session.exec(stmt).all())
    return showtimes


def get_agenda_showtimes(
    *,
    session: Session,
    user_id: UUID,
    snapshot_time: datetime,
    include_interested: bool,
    include_invited: bool,
    limit: int,
    offset: int,
) -> list[Showtime]:
    """
    Upcoming showtimes for the user's personal agenda: ones they are GOING to
    (always), INTERESTED in (when ``include_interested``), or have an active
    received invite for (when ``include_invited``). Ordered by datetime.
    """
    going_subquery = select(ShowtimeSelection.showtime_id).where(
        col(ShowtimeSelection.user_id) == user_id,
        col(ShowtimeSelection.going_status) == GoingStatus.GOING,
    )
    conditions = [col(Showtime.id).in_(going_subquery)]

    if include_interested:
        interested_subquery = select(ShowtimeSelection.showtime_id).where(
            col(ShowtimeSelection.user_id) == user_id,
            col(ShowtimeSelection.going_status) == GoingStatus.INTERESTED,
        )
        conditions.append(col(Showtime.id).in_(interested_subquery))

    if include_invited:
        invited_subquery = select(ShowtimePing.showtime_id).where(
            col(ShowtimePing.receiver_id) == user_id,
            col(ShowtimePing.dismissed_at).is_(None),
        )
        conditions.append(col(Showtime.id).in_(invited_subquery))

    stmt = (
        select(Showtime)
        .where(col(Showtime.datetime) >= snapshot_time, or_(*conditions))
        .order_by(col(Showtime.datetime))
        .limit(limit)
        .offset(offset)
    )
    return list(session.exec(stmt).all())


def count_main_page_showtimes(
    *,
    session: Session,
    user_id: ViewerId,
    filters: Filters,
    letterboxd_username: str | None = None,
) -> int:
    stmt, force_empty = _build_main_page_showtimes_query(
        session=session,
        user_id=user_id,
        filters=filters,
        letterboxd_username=letterboxd_username,
    )
    if force_empty:
        return 0

    count_stmt = select(func.count()).select_from(stmt.subquery())
    return session.execute(count_stmt).scalar_one()


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
        # A status change can flip chain visibility for other participants
        # (see get_chain_invited_user_ids), so the whole invite group is
        # rebuilt, not just the owner's own rows.
        showtime_visibility_crud.rebuild_effective_visibility_for_showtime_participants(
            session=session,
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
    showtime_visibility_crud.rebuild_effective_visibility_for_showtime_participants(
        session=session,
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

    showtime_visibility_crud.clear_effective_visibility_for_showtime(
        session=session,
        owner_id=user_id,
        showtime_id=showtime_id,
    )
    # Losing your selection can also drop chain visibility for other
    # participants who relied on you as an accepted connector.
    showtime_visibility_crud.rebuild_effective_visibility_for_showtime_participants(
        session=session,
        showtime_id=showtime_id,
    )

    return showtime
