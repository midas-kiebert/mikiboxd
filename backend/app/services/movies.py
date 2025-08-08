from datetime import datetime
from uuid import UUID

from psycopg.errors import UniqueViolation
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session

from app.converters import movie as movie_converters
from app.crud import movie as movies_crud
from app.crud import user as users_crud
from app.exceptions.base import AppError
from app.exceptions.movie_exceptions import MovieNotFoundError
from app.models.movie import MovieCreate, MovieUpdate
from app.schemas.movie import MovieLoggedIn, MovieSummaryLoggedIn


def get_movie_summaries(
    *,
    session: Session,
    user_id: UUID,
    limit: int,
    offset: int,
    showtime_limit: int,
    query: str,
    watchlist_only: bool,
    snapshot_time: datetime,
) -> list[MovieSummaryLoggedIn]:
    """
    Get a list of movie summaries for a logged-in user.

    Parameters:
        session (Session): Database session.
        user_id (UUID): ID of the user requesting the movies.
        limit (int): Maximum number of movies to return.
        offset (int): Offset for pagination.
        showtime_limit (int): Limit for showtimes.
        query (str): Search query for filtering movies.
        watchlist_only (bool): If True, only return movies in the user's watchlist.
        snapshot_time (datetime): Time to snapshot the movie data.
    Returns:
        list[MovieSummaryLoggedIn]: List of movie summaries.
    """
    print("Snapshot time in service:", snapshot_time)
    letterboxd_username = users_crud.get_letterboxd_username(
        session=session,
        user_id=user_id,
    )
    movies_db = movies_crud.get_movies(
        session=session,
        letterboxd_username=letterboxd_username,
        limit=limit,
        offset=offset,
        query=query,
        watchlist_only=watchlist_only,
        snapshot_time=snapshot_time,
        current_user_id=user_id,
    )
    users_crud.get_selected_cinemas_ids(
        session=session,
        user_id=user_id,
    )
    movies = [
        movie_converters.to_summary_logged_in(
            movie=movie,
            session=session,
            snapshot_time=snapshot_time,
            current_user=user_id,
            showtime_limit=showtime_limit,
        )
        for movie in movies_db
    ]
    return movies


def get_movie_by_id(
    *,
    session: Session,
    movie_id: int,
    current_user: UUID,
    snapshot_time: datetime,
) -> MovieLoggedIn:
    """
    Get a movie by its ID for a logged-in user.

    Parameters:
        session (Session): Database session.
        movie_id (int): ID of the movie to retrieve.
        current_user (UUID): ID of the current user.
        snapshot_time (datetime): Time to snapshot the movie data.
    Returns:
        MovieLoggedIn: Movie details for the logged-in user.
    Raises:
        MovieNotFoundError: If the movie with the given ID does not exist.
    """
    movie_db = movies_crud.get_movie_by_id(
        session=session,
        id=movie_id,
    )
    if movie_db is None:
        raise MovieNotFoundError(movie_id)
    movie_public = movie_converters.to_logged_in(
        movie=movie_db,
        session=session,
        snapshot_time=snapshot_time,
        current_user=current_user,
    )
    return movie_public


def insert_movie_if_not_exists(
    *,
    session: Session,
    movie_create: MovieCreate,
) -> bool:
    """
    Insert a movie into the database if it does not already exist.

    Parameters:
        session (Session): Database session.
        movie (MovieCreate): Movie data to insert.
    Returns:
        bool: True if the movie was inserted, False if it already exists.
    """
    try:
        movies_crud.create_movie(
            session=session,
            movie_create=movie_create,
        )
        session.commit()
        return True
    except IntegrityError as e:
        session.rollback()
        if isinstance(e.orig, UniqueViolation):
            return False
        else:
            raise AppError from e
    except Exception as e:
        session.rollback()
        raise AppError from e


def update_movie(
    *,
    session: Session,
    movie_id: int,
    movie_update: MovieUpdate,
) -> None:
    """
    Update an existing movie in the database.

    Parameters:
        session (Session): The database session.
        movie_id (int): The ID of the movie to update.
        movie_update (MovieUpdate): The movie data to update.
    Raises:
        MovieNotFoundError: If the movie with the given ID does not exist.
        AppError: If there is an error during the update operation.
    """
    movie = movies_crud.get_movie_by_id(
        session=session,
        id=movie_id,
    )
    if not movie:
        raise MovieNotFoundError(movie_id)

    try:
        movies_crud.update_movie(
            db_movie=movie,
            movie_update=movie_update,
        )
        session.commit()
    except Exception as e:
        session.rollback()
        raise AppError from e
