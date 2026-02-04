from datetime import datetime, time
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.sql.elements import ColumnElement
from sqlmodel import Session, Time, cast, col, or_

from app.core.enums import GoingStatus
from app.inputs.movie import Filters
from app.models.cinema import Cinema
from app.models.cinema_selection import CinemaSelection
from app.models.friendship import Friendship
from app.models.movie import Movie, MovieCreate, MovieUpdate
from app.models.showtime import Showtime
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
    if db_obj is None:
        db_obj = Movie(**movie_create.model_dump())
        session.add(db_obj)
        session.flush()  # Check for Unique Violations
        return db_obj
    movie_data = movie_create.model_dump(exclude_unset=True)
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
    db_obj = Movie(**movie_create.model_dump())
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
    result = session.execute(stmt)
    cinemas: list[Cinema] = list(result.scalars().all())
    return cinemas


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
        .join(Friendship, col(Friendship.friend_id) == col(User.id))
        .join(ShowtimeSelection, col(ShowtimeSelection.user_id) == col(User.id))
        .join(Showtime, col(Showtime.id) == col(ShowtimeSelection.showtime_id))
        .join(
            CinemaSelection,
            col(CinemaSelection.cinema_id) == col(Showtime.cinema_id),
        )
        .where(
            col(Friendship.user_id) == current_user,
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
) -> list[Showtime]:
    stmt = select(Showtime).where(col(Showtime.datetime) >= filters.snapshot_time)
    if filters.selected_cinema_ids is not None and len(filters.selected_cinema_ids) > 0:
        stmt = stmt.where(col(Showtime.cinema_id).in_(filters.selected_cinema_ids))
    stmt = stmt.where(col(Showtime.movie_id) == movie_id)

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

    if filters.query:
        pattern = f"%{filters.query}%"
        stmt = stmt.where(
            col(Movie.title).ilike(pattern) | col(Movie.original_title).ilike(pattern)
        )
    if filters.watchlist_only:
        stmt = stmt.join(
            WatchlistSelection, col(WatchlistSelection.movie_id) == Movie.id
        ).where(col(WatchlistSelection.letterboxd_username) == letterboxd_username)

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

    stmt = (
        stmt.group_by(col(Movie.id))
        .order_by(func.min(Showtime.datetime))
        .limit(limit)
        .offset(offset)
    )

    result = session.execute(stmt)
    movies: list[Movie] = list(result.scalars().all())
    return movies
