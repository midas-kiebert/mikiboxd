from datetime import datetime
from uuid import UUID

from sqlmodel import Session

from app.converters import cinema as cinema_converters
from app.converters import showtime as showtime_converters
from app.converters import user as user_converters
from app.crud import movie as movies_crud
from app.crud import user as user_crud
from app.models.movie import Movie
from app.schemas.movie import MovieLoggedIn, MovieSummaryLoggedIn
from app.utils import now_amsterdam_naive


def to_summary_logged_in(
    movie: Movie,
    *,
    session: Session,
    snapshot_time: datetime = now_amsterdam_naive(),
    current_user: UUID,
    showtime_limit: int = 10,
) -> MovieSummaryLoggedIn:
    """
    Convert a Movie object to a MovieSummaryLoggedIn schema, including showtimes,
    cinemas, and friends going to the movie.

    Parameters:
        movie (Movie): The Movie object to convert.
        session (Session): The database session.
        snapshot_time (datetime): The time to consider for showtimes.
        current_user (UUID): The ID of the current user.
        showtime_limit (int): The maximum number of showtimes to retrieve.
    Returns:
        MovieSummaryLoggedIn: The converted MovieSummaryLoggedIn schema.
    Raises:
        ValidationError: If the movie data is invalid.
    """
    Movie.model_validate(movie)
    showtimes = [
        showtime_converters.to_in_movie_logged_in(
            showtime=showtime,
            session=session,
            user_id=current_user,
        )
        for showtime in movies_crud.get_showtimes_for_movie(
            session=session,
            movie_id=movie.id,
            snapshot_time=snapshot_time,
            limit=showtime_limit,
            current_user_id=current_user,
        )
    ]
    cinemas = [
        cinema_converters.to_public(cinema)
        for cinema in movies_crud.get_cinemas_for_movie(
            session=session,
            movie_id=movie.id,
            snapshot_time=snapshot_time,
            current_user_id=current_user,
        )
    ]
    last_showtime_datetime = movies_crud.get_last_showtime_datetime(
        session=session,
        movie_id=movie.id,
        current_user_id=current_user,
    )
    total_showtimes = movies_crud.get_total_number_of_future_showtimes(
        session=session,
        movie_id=movie.id,
        snapshot_time=snapshot_time,
        current_user_id=current_user,
    )
    friends_going = [
        user_converters.to_public(friend)
        for friend in movies_crud.get_friends_for_movie(
            session=session,
            movie_id=movie.id,
            snapshot_time=snapshot_time,
            current_user=current_user,
        )
    ]
    going = user_crud.is_user_going_to_movie(
        session=session,
        movie_id=movie.id,
        user_id=current_user,
    )

    return MovieSummaryLoggedIn(
        **movie.model_dump(),
        showtimes=showtimes,
        cinemas=cinemas,
        last_showtime_datetime=last_showtime_datetime,
        total_showtimes=total_showtimes,
        friends_going=friends_going,
        going=going,
    )


def to_logged_in(
    movie: Movie,
    *,
    session: Session,
    snapshot_time: datetime = now_amsterdam_naive(),
    current_user: UUID,
) -> MovieLoggedIn:
    """
    Convert a Movie object to a MovieLoggedIn schema, including showtimes.

    Parameters:
        movie (Movie): The Movie object to convert.
        session (Session): The database session.
        snapshot_time (datetime): The time to consider for showtimes.
        current_user (UUID): The ID of the current user.
    Returns:
        MovieLoggedIn: The converted MovieLoggedIn schema.
    """
    Movie.model_validate(movie)
    showtimes = [
        showtime_converters.to_in_movie_logged_in(
            showtime=showtime,
            session=session,
            user_id=current_user,
        )
        for showtime in movies_crud.get_showtimes_for_movie(
            session=session,
            movie_id=movie.id,
            snapshot_time=snapshot_time,
            current_user_id=current_user,
        )
    ]
    return MovieLoggedIn(
        **movie.model_dump(),
        showtimes=showtimes,
    )
