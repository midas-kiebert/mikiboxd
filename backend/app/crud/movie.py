from collections.abc import Sequence
from datetime import datetime
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import and_, func, select
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col

from app.models import (
    Cinema,
    CinemaPublic,
    Friendship,
    Movie,
    MovieCreate,
    MoviePublic,
    MovieSummaryPublic,
    MovieUpdate,
    Showtime,
    ShowtimeSelection,
    User,
    UserPublic,
    WatchlistSelection,
)

from .showtime import get_first_n_showtimes, get_split_showtimes_for_movie

__all__ = [
    "create_movie",
    "get_movie_by_id",
    "get_movies",
    "get_movies_without_letterboxd_slug",
    "update_movie",
    "get_cinemas_for_movie",
    "get_friends_for_movie",
]


def create_movie(*, session: Session, movie_create: MovieCreate) -> Movie:
    db_obj = Movie.model_validate(movie_create)
    session.add(db_obj)
    try:
        session.commit()
        session.refresh(db_obj)
    except IntegrityError:
        session.rollback()
    return db_obj


def get_cinemas_for_movie(
    *,
    session: Session,
    movie_id: int,
    snapshot_time: datetime = datetime.now(tz=ZoneInfo("Europe/Amsterdam")).replace(
        tzinfo=None
    ),
) -> list[CinemaPublic]:
    stmt = (
        select(Cinema)
        .join(Showtime, col(Showtime.cinema_id) == col(Cinema.id))
        .where(
            col(Showtime.movie_id) == movie_id, col(Showtime.datetime) >= snapshot_time
        )
        .distinct()
    )
    result = session.execute(stmt)
    cinemas: list[Cinema] = list(result.scalars().all())
    cinemas_public = [CinemaPublic.model_validate(cinema) for cinema in cinemas]
    return cinemas_public


def get_friends_for_movie(
    *,
    session: Session,
    movie_id: int,
    snapshot_time: datetime = datetime.now(tz=ZoneInfo("Europe/Amsterdam")).replace(
        tzinfo=None
    ),
    current_user: UUID,
) -> list[UserPublic]:
    friend_subquery = (
        select(col(Friendship.friend_id).label("friend_id"))
        .where(col(Friendship.user_id) == current_user)
        .union(
            select(col(Friendship.user_id).label("friend_id")).where(
                col(Friendship.friend_id) == current_user
            )
        )
        .subquery()
    )
    assert hasattr(friend_subquery.c, "friend_id")
    friend_id_col = col(friend_subquery.c.friend_id)

    stmt = (
        select(User)
        .join(friend_subquery, col(User.id) == friend_id_col)
        .join(ShowtimeSelection, col(ShowtimeSelection.user_id) == col(User.id))
        .join(Showtime, col(Showtime.id) == col(ShowtimeSelection.showtime_id))
        .where(
            col(Showtime.movie_id) == movie_id,
            col(Showtime.datetime) >= snapshot_time,
        )
        .distinct()
    )
    result = session.execute(stmt)
    friends: list[User] = list(result.scalars().all())
    friends_public = [UserPublic.model_validate(friend) for friend in friends]
    return friends_public


def get_last_showtime_datetime(*, session: Session, movie_id: int) -> datetime | None:
    stmt = (
        select(Showtime)
        .where(col(Showtime.movie_id) == movie_id)
        .order_by(col(Showtime.datetime).desc())
        .limit(1)
    )
    result = session.execute(stmt)
    last_showtime: Showtime | None = result.scalars().first()

    if last_showtime is None:
        return None

    return last_showtime.datetime


def get_total_number_of_future_showtimes(
    *,
    session: Session,
    movie_id: int,
    snapshot_time: datetime = datetime.now(tz=ZoneInfo("Europe/Amsterdam")).replace(
        tzinfo=None
    ),
) -> int:
    stmt = select(func.count(col(Showtime.id))).where(
        col(Showtime.movie_id) == movie_id,
        col(Showtime.datetime) >= snapshot_time,
    )
    result = session.execute(stmt)
    total_showtimes: int = result.scalar_one_or_none() or 0
    return total_showtimes


def get_movies(
    *,
    session: Session,
    user_id: UUID,
    limit: int = 50,
    offset: int = 0,
    showtime_limit: int = 10,
    snapshot_time: datetime = datetime.now(tz=ZoneInfo("Europe/Amsterdam")).replace(
        tzinfo=None
    ),
    query: str | None = None,
    watchlist_only: bool = False,
) -> list[MovieSummaryPublic]:
    stmt = select(Movie).join(
        Showtime,
        and_(
            col(Showtime.movie_id) == col(Movie.id),
            col(Showtime.datetime) >= snapshot_time,
        ),
    )
    if query:
        stmt = stmt.where(col(Movie.title).ilike(f"%{query}%"))
    if watchlist_only:
        stmt = stmt.join(
            WatchlistSelection,
            and_(
                col(WatchlistSelection.movie_id) == col(Movie.id),
                col(WatchlistSelection.user_id) == user_id,
            ),
        )
    stmt = (
        stmt.group_by(col(Movie.id))
        .order_by(func.min(Showtime.datetime))
        .limit(limit)
        .offset(offset)
    )

    result = session.execute(stmt)
    db_movies: list[Movie] = list(result.scalars().all())
    movies: list[MovieSummaryPublic] = [
        MovieSummaryPublic.model_validate(movie) for movie in db_movies
    ]

    for movie in movies:
        movie.showtimes = get_first_n_showtimes(
            session=session, movie_id=movie.id, n=showtime_limit
        )
        movie.cinemas = get_cinemas_for_movie(
            session=session, movie_id=movie.id, snapshot_time=snapshot_time
        )
        movie.last_showtime_datetime = get_last_showtime_datetime(
            session=session, movie_id=movie.id
        )
        movie.total_showtimes = get_total_number_of_future_showtimes(
            session=session, movie_id=movie.id, snapshot_time=snapshot_time
        )
        movie.friends_going = get_friends_for_movie(
            session=session,
            movie_id=movie.id,
            snapshot_time=snapshot_time,
            current_user=user_id,
        )
    return movies


def get_movie_by_id(*, session: Session, id: int, user_id: UUID) -> MoviePublic:
    """
    Retrieve a movie by its TMDB ID.
    """
    movie = session.get(Movie, id)
    if movie is None:
        raise ValueError(f"Movie with ID {id} not found.")
    movie_public = MoviePublic.model_validate(movie)
    (
        movie_public.showtimes_with_friends,
        movie_public.showtime_without_friends,
    ) = get_split_showtimes_for_movie(
        session=session, movie_id=movie.id, current_user=user_id
    )
    return movie_public


def get_movies_without_letterboxd_slug(*, session: Session) -> Sequence[Movie]:
    """
    Retrieve all movies that do not have a Letterboxd slug.
    """
    stmt = select(Movie).where(col(Movie.letterboxd_slug).is_(None))
    result = session.execute(stmt)
    return result.scalars().all()


def update_movie(
    *, session: Session, db_movie: Movie, movie_update: MovieUpdate
) -> Movie:
    movie_data = movie_update.model_dump(exclude_unset=True)
    db_movie.sqlmodel_update(movie_data)
    session.add(db_movie)
    session.commit()
    session.refresh(db_movie)
    return db_movie
