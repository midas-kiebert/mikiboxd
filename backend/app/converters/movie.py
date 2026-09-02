from datetime import datetime

from sqlmodel import Session

from app.converters import cinema as cinema_converters
from app.converters import showtime as showtime_converters
from app.converters import user as user_converters
from app.core.enums import GoingStatus
from app.core.viewer import ViewerId
from app.crud import movie as movies_crud
from app.crud import user as user_crud
from app.inputs.movie import Filters
from app.models.movie import Movie
from app.schemas.movie import (
    MovieInShowtime,
    MoviePublic,
    MovieSummaryPublic,
    MovieSummaryViewerState,
    MovieViewerState,
)
from app.schemas.user import UserPublic


def to_in_showtime(movie: Movie) -> MovieInShowtime:
    Movie.model_validate(movie)
    return MovieInShowtime(**movie.model_dump())


def _friends_on_movie(
    *,
    session: Session,
    movie_id: int,
    current_user: ViewerId,
    snapshot_time: datetime,
) -> tuple[list[UserPublic], list[UserPublic]]:
    """Friends going to / interested in this movie, in that order of precedence.

    Empty for an anonymous viewer, who has no friends to speak of here.
    """
    if current_user is None:
        return [], []
    friends_going = [
        user_converters.to_public(friend)
        for friend in movies_crud.get_friends_for_movie(
            session=session,
            movie_id=movie_id,
            snapshot_time=snapshot_time,
            current_user=current_user,
            going_status=GoingStatus.GOING,
        )
    ]
    going_ids = {friend.id for friend in friends_going}
    friends_interested = [
        user_converters.to_public(friend)
        for friend in movies_crud.get_friends_for_movie(
            session=session,
            movie_id=movie_id,
            snapshot_time=snapshot_time,
            current_user=current_user,
            going_status=GoingStatus.INTERESTED,
        )
        if friend.id not in going_ids
    ]
    return friends_going, friends_interested


def friends_letterboxd_lists_for_movie(
    *,
    session: Session,
    movie_id: int,
    current_user: ViewerId,
) -> tuple[list[UserPublic], list[UserPublic]]:
    """Friends who have this movie watchlisted / watched on Letterboxd.

    Shared by the movie page and the showtime sheet, which show the same pair.
    Empty for an anonymous viewer.
    """
    if current_user is None:
        return [], []
    friends_watchlisted = [
        user_converters.to_public(friend)
        for friend in movies_crud.get_friends_who_watchlisted_movie(
            session=session,
            movie_id=movie_id,
            current_user=current_user,
        )
    ]
    friends_watched = [
        user_converters.to_public(friend)
        for friend in movies_crud.get_friends_who_watched_movie(
            session=session,
            movie_id=movie_id,
            current_user=current_user,
        )
    ]
    return friends_watchlisted, friends_watched


def to_summary_public(
    movie: Movie,
    *,
    session: Session,
    current_user: ViewerId,
    showtime_limit: int = 10,
    filters: Filters,
) -> MovieSummaryPublic:
    """Movie card: the film and its screenings, plus the viewer's own state when
    there is a viewer — see `app.core.viewer`."""
    Movie.model_validate(movie)
    movie_showtimes = movies_crud.get_showtimes_for_movie(
        session=session,
        movie_id=movie.id,
        limit=showtime_limit,
        filters=filters,
        current_user_id=current_user,
    )
    visibility_modes = showtime_converters.viewer_visibility_modes(
        session=session, showtimes=movie_showtimes, user_id=current_user
    )
    showtimes = [
        showtime_converters.to_in_movie_public(
            showtime=showtime,
            session=session,
            user_id=current_user,
            visibility_modes=visibility_modes,
        )
        for showtime in movie_showtimes
    ]
    cinemas = [
        cinema_converters.to_public(cinema)
        for cinema in movies_crud.get_cinemas_for_movie(
            session=session, movie_id=movie.id, filters=filters
        )
    ]
    last_showtime_datetime = movies_crud.get_last_showtime_datetime(
        session=session, movie_id=movie.id, filters=filters
    )
    total_showtimes = movies_crud.get_total_number_of_future_showtimes(
        session=session, movie_id=movie.id, filters=filters
    )

    viewer: MovieSummaryViewerState | None = None
    if current_user is not None:
        friends_going, friends_interested = _friends_on_movie(
            session=session,
            movie_id=movie.id,
            current_user=current_user,
            snapshot_time=filters.snapshot_time,
        )
        viewer = MovieSummaryViewerState(
            going=user_crud.is_user_going_to_movie(
                session=session,
                movie_id=movie.id,
                user_id=current_user,
                snapshot_time=filters.snapshot_time,
            ),
            friends_going=friends_going,
            friends_interested=friends_interested,
        )

    return MovieSummaryPublic(
        **movie.model_dump(),
        showtimes=showtimes,
        cinemas=cinemas,
        last_showtime_datetime=last_showtime_datetime,
        total_showtimes=total_showtimes,
        viewer=viewer,
    )


def to_public(
    movie: Movie,
    *,
    session: Session,
    current_user: ViewerId,
    filters: Filters,
    showtime_limit: int | None = None,
) -> MoviePublic:
    """
    Convert a Movie object to a MoviePublic schema, including showtimes.

    Parameters:
        movie (Movie): The Movie object to convert.
        session (Session): The database session.
        filters (Filters): Which showtimes to include.
        current_user (ViewerId): Who to annotate for. None leaves `viewer`
            unset, which is how the response says nobody was asking — see
            `app.core.viewer`.
    Returns:
        MoviePublic: The converted MoviePublic schema.
    """
    Movie.model_validate(movie)
    movie_showtimes = movies_crud.get_showtimes_for_movie(
        session=session,
        movie_id=movie.id,
        limit=showtime_limit,
        filters=filters,
        current_user_id=current_user,
    )
    visibility_modes = showtime_converters.viewer_visibility_modes(
        session=session, showtimes=movie_showtimes, user_id=current_user
    )
    showtimes = [
        showtime_converters.to_in_movie_public(
            showtime=showtime,
            session=session,
            user_id=current_user,
            visibility_modes=visibility_modes,
        )
        for showtime in movie_showtimes
    ]

    viewer: MovieViewerState | None = None
    if current_user is not None:
        friends_watchlisted, friends_watched = friends_letterboxd_lists_for_movie(
            session=session,
            movie_id=movie.id,
            current_user=current_user,
        )
        viewer = MovieViewerState(
            friends_watchlisted=friends_watchlisted,
            friends_watched=friends_watched,
        )

    return MoviePublic(
        **movie.model_dump(),
        showtimes=showtimes,
        viewer=viewer,
    )
