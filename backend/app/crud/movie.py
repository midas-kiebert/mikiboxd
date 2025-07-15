from collections.abc import Sequence
from datetime import datetime
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import and_, func, select
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session

from app.models import Movie, MovieCreate, MoviePublic, MovieUpdate, Showtime
from app.models.utils import column

from .showtime import get_first_n_showtimes, get_split_showtimes_for_movie

__all__ = [
    "create_movie",
    "get_movie_by_id",
    "get_movies",
    "get_movies_without_letterboxd_slug",
    "search_movies",
    "update_movie",
]


def create_movie(*, session: Session, movie_create: MovieCreate) -> None:
    db_obj = Movie.model_validate(movie_create)
    session.add(db_obj)
    try:
        session.commit()
        session.refresh(db_obj)
    except IntegrityError:
        session.rollback()


def get_movies(
    *,
    session: Session,
    limit: int = 50,
    offset: int = 0,
    showtime_limit: int = 10,
    snapshot_time: datetime = datetime.now(tz=ZoneInfo("Europe/Amsterdam")).replace(
        tzinfo=None
    ),
    query: str | None = None,
) -> Sequence[Movie]:
    stmt = (
        select(Movie)
        .join(
            Showtime,
            and_(
                column(Showtime.movie_id) == column(Movie.id),
                column(Showtime.datetime) >= snapshot_time,
            ),
        )
        .group_by(column(Movie.id))
        .order_by(func.min(Showtime.datetime))
        .limit(limit)
        .offset(offset)
    )
    if query:
        stmt = stmt.where(column(Movie.title).ilike(f"%{query}%"))
    result = session.execute(stmt)
    movies: list[Movie] = list(result.scalars().all())

    for movie in movies:
        movie.showtimes = get_first_n_showtimes(
            session=session, movie=movie, n=showtime_limit
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
    movie_public.showtimes_with_friends, movie_public.showtime_without_friends = (
        get_split_showtimes_for_movie(
            session=session, movie_id=movie.id, current_user=user_id
        )
    )
    return movie_public


def get_movies_without_letterboxd_slug(*, session: Session) -> Sequence[Movie]:
    """
    Retrieve all movies that do not have a Letterboxd slug.
    """
    stmt = select(Movie).where(column(Movie.letterboxd_slug).is_(None))
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


def search_movies(
    *,
    session: Session,
    query: str,
    limit: int = 10,
    offset: int = 0,
    showtime_limit: int = 5,
) -> list[Movie]:
    stmt = (
        select(Movie)
        .where(column(Movie.title).ilike(f"%{query}%"))
        .join(
            Showtime,
            and_(
                column(Showtime.movie_id) == Movie.id,
                column(Showtime.datetime)
                >= datetime.now(tz=ZoneInfo("Europe/Amsterdam")).replace(tzinfo=None),
            ),
        )
        .group_by(column(Movie.id))
        .order_by(func.min(Showtime.datetime))
        .limit(limit)
        .offset(offset)
    )
    result = session.execute(stmt)
    movies: list[Movie] = list(result.scalars().all())

    for movie in movies:
        movie.showtimes = get_first_n_showtimes(
            session=session, movie=movie, n=showtime_limit
        )
    return movies
