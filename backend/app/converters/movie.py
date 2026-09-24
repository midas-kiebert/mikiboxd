from collections.abc import Sequence

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
from app.models.user import User
from app.schemas.movie import (
    MovieInShowtime,
    MoviePublic,
    MovieSummaryPublic,
    MovieSummaryViewerState,
    MovieViewerState,
)
from app.schemas.user import UserPublic


def to_in_showtime(movie: Movie) -> MovieInShowtime:
    return MovieInShowtime(**movie.model_dump())


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


def summaries_for_page(
    movies: Sequence[Movie],
    *,
    session: Session,
    current_user: ViewerId,
    showtime_limit: int = 10,
    filters: Filters,
) -> list[MovieSummaryPublic]:
    """Movie cards for a whole page, in a fixed number of queries.

    Mirrors `converters.showtime_page`: every part of a card that isn't the
    film itself — its screenings' viewer state, who's going, which cinemas
    show it — is a question that can be asked once for the whole page instead
    of once per movie (and, for the nested showtimes, once per showtime, which
    is where most of the cost was). See that module's docstring for why asking
    it a row at a time doesn't scale.
    """
    # Imported here rather than at module scope: `showtime_page` imports
    # `converters.user`, which imports `converters.showtime`, which imports
    # this module — a module-level import here would cycle back on itself.
    from app.converters import showtime_page as showtime_page_converters

    if len(movies) == 0:
        return []

    movie_ids = [movie.id for movie in movies]

    showtimes_by_movie_id = movies_crud.get_showtimes_for_movies(
        session=session,
        movie_ids=movie_ids,
        limit=showtime_limit,
        filters=filters,
        current_user_id=current_user,
    )
    all_showtimes = [
        showtime
        for showtimes in showtimes_by_movie_id.values()
        for showtime in showtimes
    ]
    visibility_modes = showtime_converters.viewer_visibility_modes(
        session=session, showtimes=all_showtimes, user_id=current_user
    )
    viewer_states = (
        showtime_page_converters.in_movie_viewer_states_for_showtimes(
            session=session,
            showtimes=all_showtimes,
            user_id=current_user,
            visibility_modes=visibility_modes,
        )
        if current_user is not None
        else {}
    )

    cinemas_by_movie_id = movies_crud.get_cinemas_for_movies(
        session=session, movie_ids=movie_ids, filters=filters
    )
    last_showtime_by_movie_id = movies_crud.get_last_showtime_datetimes(
        session=session, movie_ids=movie_ids, filters=filters
    )
    total_showtimes_by_movie_id = (
        movies_crud.get_total_number_of_future_showtimes_for_movies(
            session=session, movie_ids=movie_ids, filters=filters
        )
    )

    going_by_movie_id: dict[int, GoingStatus] = {}
    friends_going_by_movie_id: dict[int, list[User]] = {}
    friends_interested_by_movie_id: dict[int, list[User]] = {}
    if current_user is not None:
        going_by_movie_id = user_crud.get_going_status_for_movies(
            session=session,
            movie_ids=movie_ids,
            user_id=current_user,
            snapshot_time=filters.snapshot_time,
        )
        friends_going_by_movie_id = movies_crud.get_friends_for_movies(
            session=session,
            movie_ids=movie_ids,
            snapshot_time=filters.snapshot_time,
            current_user=current_user,
            going_status=GoingStatus.GOING,
        )
        friends_interested_by_movie_id = movies_crud.get_friends_for_movies(
            session=session,
            movie_ids=movie_ids,
            snapshot_time=filters.snapshot_time,
            current_user=current_user,
            going_status=GoingStatus.INTERESTED,
        )

    summaries: list[MovieSummaryPublic] = []
    for movie in movies:
        showtimes = [
            showtime_converters.to_in_movie_public(
                showtime=showtime,
                session=session,
                user_id=current_user,
                visibility_modes=visibility_modes,
                viewer_states=viewer_states,
            )
            for showtime in showtimes_by_movie_id.get(movie.id, [])
        ]
        cinemas = [
            cinema_converters.to_public(cinema)
            for cinema in cinemas_by_movie_id.get(movie.id, [])
        ]

        viewer: MovieSummaryViewerState | None = None
        if current_user is not None:
            friends_going = [
                user_converters.to_public(friend)
                for friend in friends_going_by_movie_id.get(movie.id, [])
            ]
            going_ids = {friend.id for friend in friends_going}
            friends_interested = [
                user_converters.to_public(friend)
                for friend in friends_interested_by_movie_id.get(movie.id, [])
                if friend.id not in going_ids
            ]
            viewer = MovieSummaryViewerState(
                going=going_by_movie_id.get(movie.id, GoingStatus.NOT_GOING),
                friends_going=friends_going,
                friends_interested=friends_interested,
            )

        summaries.append(
            MovieSummaryPublic(
                **movie.model_dump(),
                showtimes=showtimes,
                cinemas=cinemas,
                last_showtime_datetime=last_showtime_by_movie_id.get(movie.id),
                total_showtimes=total_showtimes_by_movie_id.get(movie.id, 0),
                viewer=viewer,
            )
        )
    return summaries


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
    # See the comment in `summaries_for_page` on why this import is local.
    from app.converters import showtime_page as showtime_page_converters

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
    viewer_states = (
        showtime_page_converters.in_movie_viewer_states_for_showtimes(
            session=session,
            showtimes=movie_showtimes,
            user_id=current_user,
            visibility_modes=visibility_modes,
        )
        if current_user is not None
        else {}
    )
    showtimes = [
        showtime_converters.to_in_movie_public(
            showtime=showtime,
            session=session,
            user_id=current_user,
            visibility_modes=visibility_modes,
            viewer_states=viewer_states,
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
