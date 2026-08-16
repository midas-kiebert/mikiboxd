from psycopg.errors import UniqueViolation
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session

from app.converters import movie as movie_converters
from app.converters import showtime as showtime_converters
from app.core.viewer import ViewerId
from app.crud import movie as movies_crud
from app.crud import showtime as showtime_crud
from app.exceptions.base import AppError
from app.exceptions.movie_exceptions import MovieNotFoundError
from app.inputs.movie import Filters
from app.models.movie import Movie, MovieCreate, MovieUpdate
from app.schemas.movie import MoviePublic, MovieSummaryPublic
from app.schemas.showtime import ShowtimeInMoviePublic
from app.scraping.logger import logger
from app.scraping.tmdb_movie_details import get_tmdb_movie_details
from app.services import viewer_context


def get_movie_summaries(
    *,
    session: Session,
    user_id: ViewerId,
    limit: int,
    offset: int,
    showtime_limit: int,
    filters: Filters,
) -> list[MovieSummaryPublic]:
    letterboxd_username = viewer_context.letterboxd_username_for(
        session=session, viewer_id=user_id
    )
    viewer_context.apply_viewer_defaults(
        session=session, viewer_id=user_id, filters=filters
    )

    movies_db = movies_crud.get_movies(
        session=session,
        current_user_id=user_id,
        letterboxd_username=letterboxd_username,
        limit=limit,
        offset=offset,
        filters=filters,
    )
    movies = [
        movie_converters.to_summary_public(
            movie=movie,
            session=session,
            current_user=user_id,
            showtime_limit=showtime_limit,
            filters=filters,
        )
        for movie in movies_db
    ]
    return movies


def count_movie_summaries(
    *,
    session: Session,
    user_id: ViewerId,
    filters: Filters,
) -> int:
    letterboxd_username = viewer_context.letterboxd_username_for(
        session=session, viewer_id=user_id
    )
    viewer_context.apply_viewer_defaults(
        session=session, viewer_id=user_id, filters=filters
    )

    return movies_crud.count_movies(
        session=session,
        current_user_id=user_id,
        letterboxd_username=letterboxd_username,
        filters=filters,
    )


def get_movie_by_id(
    *,
    session: Session,
    movie_id: int,
    current_user: ViewerId,
    filters: Filters,
    showtime_limit: int | None = None,
) -> MoviePublic:
    """
    Get a movie by its ID, annotated for the requesting viewer.

    Parameters:
        session (Session): Database session.
        movie_id (int): ID of the movie to retrieve.
        current_user (ViewerId): Who to annotate for; None for an anonymous
            visitor — see `app.core.viewer`.
        snapshot_time (datetime): Time to snapshot the movie data.
    Returns:
        MoviePublic: Movie details for the requesting viewer.
    Raises:
        MovieNotFoundError: If the movie with the given ID does not exist.
    """
    movie_db = movies_crud.get_movie_by_id(
        session=session,
        id=movie_id,
    )
    if movie_db is None:
        raise MovieNotFoundError(movie_id)
    movie_public = movie_converters.to_public(
        movie=movie_db,
        session=session,
        current_user=current_user,
        filters=filters,
        showtime_limit=showtime_limit,
    )
    return movie_public


def get_movie_showtimes(
    *,
    session: Session,
    movie_id: int,
    current_user: ViewerId,
    limit: int,
    offset: int,
    filters: Filters,
) -> list[ShowtimeInMoviePublic]:
    movie_db = movies_crud.get_movie_by_id(
        session=session,
        id=movie_id,
    )
    if movie_db is None:
        raise MovieNotFoundError(movie_id)

    letterboxd_username = None
    if filters.watchlist_only or filters.hide_watched:
        letterboxd_username = viewer_context.letterboxd_username_for(
            session=session,
            viewer_id=current_user,
        )

    showtimes = movies_crud.get_showtimes_for_movie(
        session=session,
        movie_id=movie_id,
        limit=limit,
        offset=offset,
        filters=filters,
        current_user_id=current_user,
        letterboxd_username=letterboxd_username,
    )

    return [
        showtime_converters.to_in_movie_public(
            showtime=showtime,
            session=session,
            user_id=current_user,
        )
        for showtime in showtimes
    ]


def upsert_movie(
    *,
    session: Session,
    movie_create: MovieCreate,
    commit: bool = True,
):
    """
    Insert or update a movie in the database.

    Parameters:
        session (Session): Database session.
        movie_create (MovieCreate): Movie data to insert or update.
    """
    if commit:
        try:
            movie = movies_crud.upsert_movie(
                session=session,
                movie_create=movie_create,
            )
            session.commit()
            return movie
        except Exception as e:
            session.rollback()
            raise AppError from e

    try:
        with session.begin_nested():
            movie = movies_crud.upsert_movie(
                session=session,
                movie_create=movie_create,
            )
            session.flush()
            return movie
    except Exception as e:
        raise AppError from e


def insert_movie_if_not_exists(
    *,
    session: Session,
    movie_create: MovieCreate,
    commit: bool = True,
) -> bool:
    """
    Insert a movie into the database if it does not already exist.

    Parameters:
        session (Session): Database session.
        movie (MovieCreate): Movie data to insert.
    Returns:
        bool: True if the movie was inserted, False if it already exists.
    """
    if commit:
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

    try:
        with session.begin_nested():
            movies_crud.create_movie(
                session=session,
                movie_create=movie_create,
            )
            session.flush()
            return True
    except IntegrityError as e:
        if isinstance(e.orig, UniqueViolation):
            return False
        else:
            raise AppError from e
    except Exception as e:
        raise AppError from e


def reassign_movies_for_cache_correction(
    *,
    session: Session,
    cache_id: int,
    old_tmdb_id: int,
    new_tmdb_id: int,
) -> None:
    """After an admin corrects a TMDB lookup-cache entry, fix every showtime
    that cache entry produced: create/update the correct Movie, move exactly
    those showtimes onto it, and unlist the stale movie if nothing else
    still references it (kept, not deleted, since watchlist/selection
    history may still reference it).

    Scoped by `showtime.tmdb_cache_id` rather than `Movie.tmdb_cache_id`: a
    different, still-valid cache entry can resolve to the same old movie_id
    (e.g. two cinemas' scrapers), and `Movie.tmdb_cache_id` only remembers
    whichever cache entry upserted the Movie row last — so it can't be
    trusted to gate or scope this correction.
    """
    if old_tmdb_id == new_tmdb_id:
        return
    old_movie = session.get(Movie, old_tmdb_id)
    if old_movie is None:
        return
    affected_showtimes = showtime_crud.get_showtimes_by_movie_and_cache(
        session=session, movie_id=old_tmdb_id, cache_id=cache_id
    )
    if not affected_showtimes:
        return

    tmdb_details = get_tmdb_movie_details(new_tmdb_id)
    if tmdb_details is None:
        logger.warning(
            "Cache correction to TMDB ID %s has no TMDB details; "
            "reassigning showtimes with fallback metadata.",
            new_tmdb_id,
        )
    movie_create = MovieCreate(
        id=new_tmdb_id,
        title=tmdb_details.title if tmdb_details is not None else old_movie.title,
        original_title=(
            tmdb_details.original_title if tmdb_details is not None else None
        ),
        directors=(
            tmdb_details.directors if tmdb_details is not None else old_movie.directors
        ),
        release_year=(
            tmdb_details.release_year
            if tmdb_details is not None
            else old_movie.release_year
        ),
        duration=(
            tmdb_details.runtime_minutes
            if tmdb_details is not None
            else old_movie.duration
        ),
        languages=(
            tmdb_details.spoken_languages
            if tmdb_details is not None
            else old_movie.languages
        ),
        original_language=(
            tmdb_details.original_language
            if tmdb_details is not None
            else old_movie.original_language
        ),
        description=(
            tmdb_details.description
            if tmdb_details is not None
            else old_movie.description
        ),
        tmdb_last_enriched_at=(
            tmdb_details.enriched_at if tmdb_details is not None else None
        ),
        tmdb_cache_id=cache_id,
    )
    movies_crud.upsert_movie(session=session, movie_create=movie_create)
    showtime_crud.reassign_showtimes_movie(
        session=session,
        old_movie_id=old_tmdb_id,
        new_movie_id=new_tmdb_id,
        cache_id=cache_id,
    )
    if not showtime_crud.get_showtimes_by_movie_id(
        session=session, movie_id=old_tmdb_id
    ):
        old_movie.currently_listed = False
    session.flush()


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
