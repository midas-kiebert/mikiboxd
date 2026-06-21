import re
from datetime import datetime, time, timedelta
from uuid import UUID

from sqlalchemy import String, case, false, func, select
from sqlalchemy.dialects.postgresql import ARRAY as PGArray
from sqlalchemy.orm import aliased
from sqlalchemy.sql.elements import ColumnElement
from sqlmodel import Session, Time, cast, col, or_

from app.core.enums import GoingStatus, SearchField
from app.crud.movie_set_filters import apply_movie_set_filters
from app.inputs.movie import Filters
from app.models.cinema import Cinema
from app.models.cinema_selection import CinemaSelection
from app.models.friendship import Friendship
from app.models.movie import Movie, MovieCreate, MovieUpdate
from app.models.showtime import Showtime
from app.models.showtime_selection import ShowtimeSelection
from app.models.showtime_visibility import ShowtimeVisibilityEffective
from app.models.user import User

DAY_BUCKET_CUTOFF = time(4, 0)
DAY_BUCKET_OFFSET = timedelta(
    hours=DAY_BUCKET_CUTOFF.hour,
    minutes=DAY_BUCKET_CUTOFF.minute,
    seconds=DAY_BUCKET_CUTOFF.second,
)


def _normalized_original_title(
    *,
    title: str | None,
    original_title: str | None,
) -> str | None:
    if original_title is None:
        return None
    normalized_original_title = original_title.strip()
    if not normalized_original_title:
        return None
    normalized_title = title.strip() if isinstance(title, str) else None
    if (
        normalized_title
        and normalized_original_title.casefold() == normalized_title.casefold()
    ):
        return None
    return normalized_original_title


def _normalized_letterboxd_slug(slug: str | None) -> str | None:
    if slug is None:
        return None
    normalized_slug = slug.strip()
    if not normalized_slug:
        return None
    return normalized_slug


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


def apply_language_filter(stmt, *, filters: Filters):
    """Keep movies whose main language matches, and only matching-subtitle showtimes.

    Callers must have already joined Movie onto stmt.
    """
    selected_languages = filters.selected_languages
    if not selected_languages:
        return stmt
    return stmt.where(col(Movie.original_language).in_(selected_languages)).where(
        cast(col(Showtime.subtitles), PGArray(String)).overlap(selected_languages)
    )


def get_movie_by_id(*, session: Session, id: int) -> Movie | None:
    """
    Retrieve a movie by its ID.
    Parameters:
        session (Session): The database session.
        id (int): The ID of the movie to retrieve.
    Returns:
        Movie | None: The movie object if found, otherwise None.
    """
    movie = session.get(Movie, id)
    return movie


def upsert_movie(*, session: Session, movie_create: MovieCreate) -> Movie:
    """
    Insert or update a movie in the database.

    Parameters:
        session (Session): The database session.
        movie_create (MovieCreate): The movie data to insert or update.
    Returns:
        Movie: The inserted or updated movie object.
    """
    db_obj = session.get(Movie, movie_create.id)
    movie_payload = movie_create.model_dump()
    movie_payload["original_title"] = _normalized_original_title(
        title=movie_payload.get("title")
        if isinstance(movie_payload.get("title"), str)
        else None,
        original_title=movie_payload.get("original_title")
        if isinstance(movie_payload.get("original_title"), str)
        else None,
    )
    movie_payload["letterboxd_slug"] = _normalized_letterboxd_slug(
        movie_payload.get("letterboxd_slug")
        if isinstance(movie_payload.get("letterboxd_slug"), str)
        else None
    )
    if db_obj is None:
        db_obj = Movie(**movie_payload)
        session.add(db_obj)
        session.flush()  # Check for Unique Violations
        return db_obj
    movie_data = movie_create.model_dump(exclude_unset=True)
    if "original_title" in movie_data:
        movie_data["original_title"] = _normalized_original_title(
            title=movie_data.get("title")
            if isinstance(movie_data.get("title"), str)
            else db_obj.title,
            original_title=movie_data.get("original_title")
            if isinstance(movie_data.get("original_title"), str)
            else None,
        )
    if "letterboxd_slug" in movie_data:
        normalized_slug = _normalized_letterboxd_slug(
            movie_data.get("letterboxd_slug")
            if isinstance(movie_data.get("letterboxd_slug"), str)
            else None
        )
        if normalized_slug is None:
            movie_data.pop("letterboxd_slug", None)
        else:
            movie_data["letterboxd_slug"] = normalized_slug
    # Scraper payloads can temporarily miss TMDB runtime; keep existing runtime
    # so showtime end-time fallback (start + duration + 15m) still works.
    if movie_data.get("duration") is None and db_obj.duration is not None:
        movie_data.pop("duration", None)
    # A transient TMDB lookup failure must not wipe previously-enriched language
    # data back to NULL.
    if movie_data.get("languages") is None and db_obj.languages is not None:
        movie_data.pop("languages", None)
    if (
        movie_data.get("original_language") is None
        and db_obj.original_language is not None
    ):
        movie_data.pop("original_language", None)
    db_obj.sqlmodel_update(movie_data)
    return db_obj


def create_movie(*, session: Session, movie_create: MovieCreate) -> Movie:
    """
    Create a new movie in the database. Raises an IntegrityError if the movie with that id already exists.

    Parameters:
        session (Session): The database session.
        movie_create (MovieCreate): The movie data to create.
    Returns:
        Movie: The created movie object.
    Raises:
        IntegrityError: If a movie with the same id already exists.
    """
    movie_payload = movie_create.model_dump()
    movie_payload["original_title"] = _normalized_original_title(
        title=movie_payload.get("title")
        if isinstance(movie_payload.get("title"), str)
        else None,
        original_title=movie_payload.get("original_title")
        if isinstance(movie_payload.get("original_title"), str)
        else None,
    )
    movie_payload["letterboxd_slug"] = _normalized_letterboxd_slug(
        movie_payload.get("letterboxd_slug")
        if isinstance(movie_payload.get("letterboxd_slug"), str)
        else None
    )
    db_obj = Movie(**movie_payload)
    session.add(db_obj)
    session.flush()  # Check for Unique Violations
    return db_obj


def get_movie_by_letterboxd_slug(
    *,
    session: Session,
    letterboxd_slug: str,
) -> Movie | None:
    """
    Retrieve a movie by its Letterboxd slug.

    Parameters:
        session (Session): The database session.
        letterboxd_slug (str): The Letterboxd slug of the movie to retrieve.
    Returns:
        Movie | None: The movie object if found, otherwise None.
    """
    stmt = select(Movie).where(col(Movie.letterboxd_slug) == letterboxd_slug)
    result = session.execute(stmt)
    movie: Movie | None = result.scalars().one_or_none()
    return movie


def get_movies_without_letterboxd_slug(*, session: Session) -> list[Movie]:
    """
    Retrieve all movies that do not have a Letterboxd slug.

    Parameters:
        session (Session): The database session.
    Returns:
        list[Movie]: A list of movies without a Letterboxd slug.
    """
    stmt = select(Movie).where(col(Movie.letterboxd_slug).is_(None))
    result = session.execute(stmt)
    movies: list[Movie] = list(result.scalars().all())
    return movies


def update_movie(*, db_movie: Movie, movie_update: MovieUpdate) -> Movie:
    """
    Update an existing movie in the database. Does not flush, its the callers
    responsibility to make sure there are no integrity errors (there shouldnt be any)
    Parameters:
        session (Session): The database session.
        db_movie (Movie): The existing movie object to update.
        movie_update (MovieUpdate): The updated movie data.
    Returns:
        Movie: The updated movie object.
    """
    movie_data = movie_update.model_dump(exclude_unset=True)
    if "letterboxd_slug" in movie_data:
        normalized_slug = _normalized_letterboxd_slug(
            movie_data.get("letterboxd_slug")
            if isinstance(movie_data.get("letterboxd_slug"), str)
            else None
        )
        if normalized_slug is None:
            movie_data.pop("letterboxd_slug", None)
        else:
            movie_data["letterboxd_slug"] = normalized_slug
    db_movie.sqlmodel_update(movie_data)
    return db_movie


def get_cinemas_for_movie(
    *, session: Session, movie_id: int, filters: Filters
) -> list[Cinema]:
    stmt = (
        select(Cinema)
        .join(Showtime, col(Showtime.cinema_id) == col(Cinema.id))
        .where(
            col(Showtime.movie_id) == movie_id,
            col(Showtime.datetime) >= filters.snapshot_time,
        )
        .distinct()
    )
    if filters.selected_cinema_ids is not None and len(filters.selected_cinema_ids) > 0:
        stmt = stmt.where(col(Cinema.id).in_(filters.selected_cinema_ids))

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
        filters.runtime_min is not None
        or filters.runtime_max is not None
        or has_languages_filter
    ):
        stmt = stmt.join(Movie, col(Movie.id) == col(Showtime.movie_id))
        if filters.runtime_min is not None:
            stmt = stmt.where(col(Movie.duration) >= filters.runtime_min)
        if filters.runtime_max is not None:
            stmt = stmt.where(col(Movie.duration) <= filters.runtime_max)
        if has_languages_filter:
            stmt = apply_language_filter(stmt, filters=filters)

    result = session.execute(stmt)
    cinemas: list[Cinema] = list(result.scalars().all())
    return cinemas


# "-", "'" and plain spaces are treated as interchangeable (and droppable) so that
# e.g. "da" / "d a" / "d-a" all match a title containing "d'a".
_SEPARATOR_CHARS_REGEX = r"[-' ]"


def _strip_separators(value: str) -> str:
    return re.sub(_SEPARATOR_CHARS_REGEX, "", value)


def _strip_separators_sql(column):
    return func.regexp_replace(column, _SEPARATOR_CHARS_REGEX, "", "g")


def _unaccent_ilike(column, query: str) -> ColumnElement[bool]:
    pattern = f"%{_strip_separators(query)}%"
    return func.unaccent(_strip_separators_sql(column)).ilike(func.unaccent(pattern))


def _title_search_clause(query: str) -> ColumnElement[bool]:
    return _unaccent_ilike(col(Movie.title), query) | _unaccent_ilike(
        col(Movie.original_title), query
    )


def _array_search_clause(column, query: str) -> ColumnElement[bool]:
    # Arrays (directors/cast) are matched by joining them into a single string and
    # ILIKE-ing it — simpler than unnest() and good enough for substring search.
    return _unaccent_ilike(func.array_to_string(column, ","), query)


def _matching_cinema_ids_subquery(query: str):
    return (
        select(col(Cinema.id))
        .where(_unaccent_ilike(col(Cinema.name), query))
        .scalar_subquery()
    )


def _matching_friend_ids(
    *, session: Session, current_user_id: UUID, query: str
) -> list[UUID]:
    stmt = (
        select(col(Friendship.friend_id))
        .join(User, col(User.id) == col(Friendship.friend_id))
        .where(
            col(Friendship.user_id) == current_user_id,
            _unaccent_ilike(col(User.display_name), query),
        )
    )
    return list(session.execute(stmt).scalars().all())


def apply_search_filter(
    stmt,
    *,
    filters: Filters,
    session: Session,
    current_user_id: UUID | None,
):
    """Apply `filters.query` against whichever field `filters.search_field` selects.

    Callers must have already joined `Showtime` (and `Movie`, when search_field
    is TITLE/DIRECTOR/ACTOR) onto `stmt` before calling this.
    """
    if not filters.query:
        return stmt

    if filters.search_field == SearchField.TITLE:
        return stmt.where(_title_search_clause(filters.query))

    if filters.search_field == SearchField.DIRECTOR:
        return stmt.where(_array_search_clause(col(Movie.directors), filters.query))

    if filters.search_field == SearchField.ACTOR:
        return stmt.where(_array_search_clause(col(Movie.cast), filters.query))

    if filters.search_field == SearchField.CINEMA:
        return stmt.where(
            col(Showtime.cinema_id).in_(_matching_cinema_ids_subquery(filters.query))
        )

    # SearchField.FRIEND
    if current_user_id is None:
        return stmt.where(false())

    friend_ids = _matching_friend_ids(
        session=session, current_user_id=current_user_id, query=filters.query
    )
    if not friend_ids:
        return stmt.where(false())

    friend_selection = aliased(ShowtimeSelection)
    friend_visibility = aliased(ShowtimeVisibilityEffective)
    return (
        stmt.join(
            friend_selection,
            col(friend_selection.showtime_id) == col(Showtime.id),
        )
        .join(
            friend_visibility,
            (col(friend_visibility.owner_id) == col(friend_selection.user_id))
            & (col(friend_visibility.showtime_id) == col(Showtime.id))
            & (col(friend_visibility.viewer_id) == current_user_id),
        )
        .where(
            col(friend_selection.user_id).in_(friend_ids),
            col(friend_selection.going_status).in_(
                [GoingStatus.GOING, GoingStatus.INTERESTED]
            ),
        )
    )


def get_friends_for_movie(
    *,
    session: Session,
    movie_id: int,
    snapshot_time: datetime,
    current_user: UUID,
    going_status: GoingStatus = GoingStatus.GOING,
) -> list[User]:
    """
    Retrieve friends who have selected a specific movie at or after a snapshot time.

    Parameters:
        session (Session): The database session.
        movie_id (int): The ID of the movie.
        snapshot_time (datetime): The time to consider for showtimes.
        current_user (UUID): The ID of the current user.
    Returns:
        list[User]: A list of User objects representing friends who have selected the movie.
    """
    stmt = (
        select(User)
        .join(ShowtimeSelection, col(ShowtimeSelection.user_id) == col(User.id))
        .join(Showtime, col(Showtime.id) == col(ShowtimeSelection.showtime_id))
        .join(
            ShowtimeVisibilityEffective,
            (col(ShowtimeVisibilityEffective.owner_id) == col(User.id))
            & (col(ShowtimeVisibilityEffective.showtime_id) == col(Showtime.id))
            & (col(ShowtimeVisibilityEffective.viewer_id) == current_user),
        )
        .join(
            CinemaSelection,
            col(CinemaSelection.cinema_id) == col(Showtime.cinema_id),
        )
        .where(
            col(Showtime.movie_id) == movie_id,
            col(Showtime.datetime) >= snapshot_time,
            col(CinemaSelection.user_id) == current_user,
            col(ShowtimeSelection.going_status) == going_status,
        )
        .distinct()
    )
    result = session.execute(stmt)
    friends: list[User] = list(result.scalars().all())
    return friends


def get_showtimes_for_movie(
    *,
    session: Session,
    movie_id: int,
    limit: int | None = None,
    offset: int = 0,
    filters: Filters,
    current_user_id: UUID | None = None,
    letterboxd_username: str | None = None,
) -> list[Showtime]:
    stmt = select(Showtime).where(col(Showtime.datetime) >= filters.snapshot_time)
    if filters.selected_cinema_ids is not None and len(filters.selected_cinema_ids) > 0:
        stmt = stmt.where(col(Showtime.cinema_id).in_(filters.selected_cinema_ids))
    stmt = stmt.where(col(Showtime.movie_id) == movie_id)

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
    needs_movie_join = (
        filters.runtime_min is not None
        or filters.runtime_max is not None
        or has_languages_filter
    )
    if filters.query and filters.search_field in (
        SearchField.TITLE,
        SearchField.DIRECTOR,
        SearchField.ACTOR,
    ):
        needs_movie_join = True
    if needs_movie_join:
        stmt = stmt.join(Movie, col(Movie.id) == col(Showtime.movie_id))

    stmt = apply_search_filter(
        stmt, filters=filters, session=session, current_user_id=current_user_id
    )

    if filters.runtime_min is not None:
        stmt = stmt.where(col(Movie.duration) >= filters.runtime_min)

    if filters.runtime_max is not None:
        stmt = stmt.where(col(Movie.duration) <= filters.runtime_max)

    if has_languages_filter:
        stmt = apply_language_filter(stmt, filters=filters)

    # Movie-set filters (watchlist / watched / lists) only apply when a username is
    # supplied. Callers building grouped movie *cards* (to_summary_logged_in) do not
    # pass one — those cards must always show the movie's own showtimes, since the
    # movie already qualified via the list-level query. Without this guard the
    # "include requested but no username" path would force an empty result and the
    # card would render no showtimes.
    if letterboxd_username is not None:
        stmt, force_empty = apply_movie_set_filters(
            stmt,
            movie_id_col=col(Showtime.movie_id),
            filters=filters,
            letterboxd_username=letterboxd_username,
        )
        if force_empty:
            return []

    if (
        current_user_id is not None
        and filters.selected_statuses is not None
        and len(filters.selected_statuses) > 0
    ):
        visible_row = aliased(ShowtimeVisibilityEffective)
        stmt = (
            stmt.join(
                ShowtimeSelection,
                col(ShowtimeSelection.showtime_id) == col(Showtime.id),
            )
            .outerjoin(
                visible_row,
                (col(visible_row.owner_id) == col(ShowtimeSelection.user_id))
                & (col(visible_row.showtime_id) == col(Showtime.id))
                & (col(visible_row.viewer_id) == current_user_id),
            )
            .where(
                or_(
                    col(ShowtimeSelection.user_id) == current_user_id,
                    col(visible_row.viewer_id).is_not(None),
                ),
                col(ShowtimeSelection.going_status).in_(filters.selected_statuses),
            )
            .distinct()
        )

    stmt = stmt.order_by(col(Showtime.datetime))
    if offset:
        stmt = stmt.offset(offset)

    if limit is not None:
        stmt = stmt.limit(limit)

    result = session.execute(stmt)
    showtimes: list[Showtime] = list(result.scalars().all())

    return showtimes


def get_last_showtime_datetime(
    *, session: Session, movie_id: int, filters: Filters
) -> datetime | None:
    stmt = select(Showtime).where(col(Showtime.movie_id) == movie_id)
    if filters.selected_cinema_ids:
        stmt = stmt.where(col(Showtime.cinema_id).in_(filters.selected_cinema_ids))

    stmt = stmt.order_by(col(Showtime.datetime).desc()).limit(1)

    result = session.execute(stmt)
    last_showtime: Showtime | None = result.scalars().one_or_none()

    if last_showtime is None:
        return None

    return last_showtime.datetime


def get_total_number_of_future_showtimes(
    *, session: Session, movie_id: int, filters: Filters
) -> int:
    stmt = (
        select(func.count(col(Showtime.id)))
        .select_from(Showtime)
        .where(
            col(Showtime.movie_id) == movie_id,
            col(Showtime.datetime) >= filters.snapshot_time,
        )
    )

    if filters.selected_cinema_ids:
        stmt = stmt.where(col(Showtime.cinema_id).in_(filters.selected_cinema_ids))

    result = session.execute(stmt)
    total_showtimes: int = result.scalar_one_or_none() or 0
    return total_showtimes


def get_movies(
    *,
    session: Session,
    current_user_id: UUID,
    letterboxd_username: str | None,
    limit: int,
    offset: int,
    filters: Filters,
) -> list[Movie]:
    stmt = (
        select(Movie)
        .join(Showtime, col(Movie.id) == Showtime.movie_id)
        .where(
            col(Showtime.datetime) >= filters.snapshot_time,
        )
    )
    if filters.selected_cinema_ids is not None and len(filters.selected_cinema_ids) > 0:
        stmt = stmt.where(col(Showtime.cinema_id).in_(filters.selected_cinema_ids))

    stmt = apply_search_filter(
        stmt, filters=filters, session=session, current_user_id=current_user_id
    )

    if filters.runtime_min is not None:
        stmt = stmt.where(col(Movie.duration) >= filters.runtime_min)

    if filters.runtime_max is not None:
        stmt = stmt.where(col(Movie.duration) <= filters.runtime_max)

    stmt = apply_language_filter(stmt, filters=filters)

    stmt, force_empty = apply_movie_set_filters(
        stmt,
        movie_id_col=col(Movie.id),
        filters=filters,
        letterboxd_username=letterboxd_username,
    )
    if force_empty:
        return []

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
                & (col(visible_row.viewer_id) == current_user_id),
            )
            .where(
                or_(
                    col(ShowtimeSelection.user_id) == current_user_id,
                    col(visible_row.viewer_id).is_not(None),
                ),
                col(ShowtimeSelection.going_status).in_(filters.selected_statuses),
            )
        )

    order_terms: list[ColumnElement] = []
    if filters.query and filters.search_field == SearchField.TITLE:
        normalized_query = _strip_separators(filters.query.strip().lower())
        order_terms.append(
            case(
                (
                    func.unaccent(_strip_separators_sql(func.lower(col(Movie.title))))
                    == func.unaccent(normalized_query),
                    0,
                ),
                (
                    func.unaccent(
                        _strip_separators_sql(func.lower(col(Movie.original_title)))
                    )
                    == func.unaccent(normalized_query),
                    0,
                ),
                else_=1,
            )
        )
    order_terms.append(func.min(Showtime.datetime))

    stmt = (
        stmt.group_by(col(Movie.id)).order_by(*order_terms).limit(limit).offset(offset)
    )

    result = session.execute(stmt)
    movies: list[Movie] = list(result.scalars().all())
    return movies


def count_movies(
    *,
    session: Session,
    current_user_id: UUID,
    letterboxd_username: str | None,
    filters: Filters,
) -> int:
    stmt = (
        select(Movie)
        .join(Showtime, col(Movie.id) == Showtime.movie_id)
        .where(
            col(Showtime.datetime) >= filters.snapshot_time,
        )
    )
    if filters.selected_cinema_ids is not None and len(filters.selected_cinema_ids) > 0:
        stmt = stmt.where(col(Showtime.cinema_id).in_(filters.selected_cinema_ids))

    stmt = apply_search_filter(
        stmt, filters=filters, session=session, current_user_id=current_user_id
    )

    if filters.runtime_min is not None:
        stmt = stmt.where(col(Movie.duration) >= filters.runtime_min)

    if filters.runtime_max is not None:
        stmt = stmt.where(col(Movie.duration) <= filters.runtime_max)

    stmt = apply_language_filter(stmt, filters=filters)

    stmt, force_empty = apply_movie_set_filters(
        stmt,
        movie_id_col=col(Movie.id),
        filters=filters,
        letterboxd_username=letterboxd_username,
    )
    if force_empty:
        return 0

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
                & (col(visible_row.viewer_id) == current_user_id),
            )
            .where(
                or_(
                    col(ShowtimeSelection.user_id) == current_user_id,
                    col(visible_row.viewer_id).is_not(None),
                ),
                col(ShowtimeSelection.going_status).in_(filters.selected_statuses),
            )
        )

    count_stmt = select(func.count()).select_from(
        stmt.group_by(col(Movie.id)).subquery()
    )
    return session.execute(count_stmt).scalar_one()
