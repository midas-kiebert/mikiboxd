from datetime import datetime
from uuid import UUID

from sqlalchemy import func, select
from sqlmodel import Session, col

from app.models.cinema import Cinema
from app.models.cinema_selection import CinemaSelection
from app.models.friendship import Friendship
from app.models.movie import Movie, MovieCreate, MovieUpdate
from app.models.showtime import Showtime
from app.models.showtime_selection import ShowtimeSelection
from app.models.user import User
from app.models.watchlist_selection import WatchlistSelection


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
    *,
    session: Session,
    movie_id: int,
    snapshot_time: datetime,
    current_user_id: UUID,
) -> list[Cinema]:
    """
    Retrieve all cinemas showing a movie at or after a specific snapshot time.
    Parameters:
        session (Session): The database session.
        movie_id (int): The ID of the movie.
        snapshot_time (datetime): The time to consider for showtimes.
    Returns:
        list[Cinema]: A list of cinemas showing the movie in past the snapshot time.
    """
    stmt = (
        select(Cinema)
        .join(Showtime, col(Showtime.cinema_id) == col(Cinema.id))
        .join(CinemaSelection, col(CinemaSelection.cinema_id) == col(Cinema.id))
        .where(
            col(Showtime.movie_id) == movie_id,
            col(Showtime.datetime) >= snapshot_time,
            col(CinemaSelection.user_id) == current_user_id,
        )
        .distinct()
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
    current_user_id: UUID,
    limit: int | None = None,
    snapshot_time: datetime,
) -> list[Showtime]:
    """
    Retrieve showtimes for a specific movie at or after a snapshot time.

    Parameters:
        session (Session): The database session.
        movie_id (int): The ID of the movie.
        limit (int | None): The maximum number of showtimes to retrieve. If None, no limit is applied.
        snapshot_time (datetime): The time to consider for showtimes.
    Returns:
        list[Showtime]: A list of Showtime objects for the specified movie.
    """
    stmt = (
        select(Showtime)
        .join(CinemaSelection, col(Showtime.cinema_id) == CinemaSelection.cinema_id)
        .where(
            col(Showtime.datetime) >= snapshot_time,
            col(CinemaSelection.user_id) == current_user_id,
        )
        .order_by(col(Showtime.datetime))
    )
    stmt = stmt.where(col(Showtime.movie_id) == movie_id)

    if limit is not None:
        stmt = stmt.limit(limit)

    result = session.execute(stmt)
    showtimes: list[Showtime] = list(result.scalars().all())

    return showtimes


def get_last_showtime_datetime(
    *,
    session: Session,
    movie_id: int,
    current_user_id: UUID,
) -> datetime | None:
    """
    Retrieve the last showtime datetime for a specific movie.

    Parameters:
        session (Session): The database session.
        movie_id (int): The ID of the movie.
        current_user_id (UUID): The ID of the current user.
    Returns:
        datetime | None: The last showtime datetime if found, otherwise None.
    """
    stmt = (
        select(Showtime)
        .join(
            CinemaSelection,
            col(Showtime.cinema_id) == CinemaSelection.cinema_id,
        )
        .where(
            col(CinemaSelection.user_id) == current_user_id,
            col(Showtime.movie_id) == movie_id,
        )
        .order_by(col(Showtime.datetime).desc())
        .limit(1)
    )
    result = session.execute(stmt)
    last_showtime: Showtime | None = result.scalars().one_or_none()

    if last_showtime is None:
        return None

    return last_showtime.datetime


def get_total_number_of_future_showtimes(
    *,
    session: Session,
    movie_id: int,
    snapshot_time: datetime,
    current_user_id: UUID,
) -> int:
    """
    Retrieve the total number of future showtimes for a specific movie at or after a snapshot time.

    Parameters:
        session (Session): The database session.
        movie_id (int): The ID of the movie.
        snapshot_time (datetime): The time to consider for showtimes.
    Returns:
        int: The total number of future showtimes for the specified movie.
    """
    stmt = (
        select(func.count(col(Showtime.id)))
        .select_from(Showtime)
        .join(
            CinemaSelection,
            col(Showtime.cinema_id) == CinemaSelection.cinema_id,
        )
        .where(
            col(CinemaSelection.user_id) == current_user_id,
            col(Showtime.movie_id) == movie_id,
            col(Showtime.datetime) >= snapshot_time,
        )
    )
    result = session.execute(stmt)
    total_showtimes: int = result.scalar_one_or_none() or 0
    return total_showtimes


def get_movies(
    *,
    session: Session,
    letterboxd_username: str | None,
    limit: int,
    offset: int,
    snapshot_time: datetime,
    query: str,
    watchlist_only: bool,
    current_user_id: UUID,
) -> list[Movie]:
    """
    Retrieve a list of movies based on various filters and pagination.

    Parameters:
        session (Session): The database session.
        user_id (UUID): The ID of the user.
        limit (int): The maximum number of movies to retrieve.
        offset (int): The offset for pagination.
        snapshot_time (datetime): The time to consider for showtimes.
        query (str): A search query to filter movie titles.
        watchlist_only (bool): If True, only retrieve movies in the user's watchlist.
    Returns:
        list[Movie]: A list of Movie objects based on the specified filters and pagination.
    """
    stmt = (
        select(Movie)
        .join(Showtime, col(Movie.id) == Showtime.movie_id)
        .join(CinemaSelection, col(Showtime.cinema_id) == CinemaSelection.cinema_id)
        .where(
            col(Showtime.datetime) >= snapshot_time,
            col(CinemaSelection.user_id) == current_user_id,
        )
    )
    if query:
        stmt = stmt.where(col(Movie.title).ilike(f"%{query}%"))
    if watchlist_only:
        stmt = stmt.join(
            WatchlistSelection, col(WatchlistSelection.movie_id) == Movie.id
        ).where(col(WatchlistSelection.letterboxd_username) == letterboxd_username)
    stmt = (
        stmt.group_by(col(Movie.id))
        .order_by(func.min(Showtime.datetime))
        .limit(limit)
        .offset(offset)
    )

    result = session.execute(stmt)
    movies: list[Movie] = list(result.scalars().all())
    return movies
