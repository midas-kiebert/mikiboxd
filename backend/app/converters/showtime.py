from uuid import UUID

from sqlmodel import Session

from app.converters import cinema as cinema_converters
from app.converters import movie as movie_converters
from app.converters import user as user_converters
from app.core.enums import GoingStatus
from app.crud import showtime as showtime_crud
from app.crud import user as user_crud
from app.models.showtime import Showtime
from app.schemas.showtime import ShowtimeInMovieLoggedIn, ShowtimeLoggedIn
from app.utils import now_amsterdam_naive


def to_logged_in(
    showtime: Showtime,
    *,
    session: Session,
    user_id: UUID,
) -> ShowtimeLoggedIn:
    """
    Converts a Showtime object to a ShowtimeLoggedIn object, including additional
    information such as friends going, whether the user is going, and related movie
    and cinema details.

    Parameters:
        showtime (Showtime): The Showtime object to convert.
        session (Session): The SQLAlchemy session for database operations.
        user_id (UUID): The ID of the current user.
    Returns:
        ShowtimeLoggedIn: The converted ShowtimeLoggedIn object with additional details.
    Raises:
        ValidationError: If the showtime does not match the expected model.
    """
    now = now_amsterdam_naive()
    Showtime.model_validate(showtime)
    friends_going = [
        user_converters.to_public(friend)
        for friend in showtime_crud.get_friends_for_showtime(
            session=session,
            showtime_id=showtime.id,
            user_id=user_id,
            going_status=GoingStatus.GOING,
        )
    ]
    friends_interested = [
        user_converters.to_public(friend)
        for friend in showtime_crud.get_friends_for_showtime(
            session=session,
            showtime_id=showtime.id,
            user_id=user_id,
            going_status=GoingStatus.INTERESTED,
        )
        if friend.id not in [friend.id for friend in friends_going]
    ]
    going = user_crud.get_showtime_going_status(
        session=session,
        showtime_id=showtime.id,
        user_id=user_id,
    )
    movie_summary = movie_converters.to_summary_logged_in(
        movie=showtime.movie,
        session=session,
        current_user=user_id,
        snapshot_time=now,
    )
    cinema = cinema_converters.to_public(
        cinema=showtime.cinema,
    )

    return ShowtimeLoggedIn(
        **showtime.model_dump(),
        friends_going=friends_going,
        friends_interested=friends_interested,
        going=going,
        movie=movie_summary,
        cinema=cinema,
    )


def to_in_movie_logged_in(
    showtime: Showtime,
    *,
    session: Session,
    user_id: UUID,
) -> ShowtimeInMovieLoggedIn:
    """
    Converts a Showtime object to a ShowtimeInMovieLoggedIn object, including additional
    information such as friends going, whether the user is going, and related cinema details.

    Parameters:
        showtime (Showtime): The Showtime object to convert.
        session (Session): The SQLAlchemy session for database operations.
        user_id (UUID): The ID of the current user.
    Returns:
        ShowtimeInMovieLoggedIn: The converted ShowtimeInMovieLoggedIn object with additional details.
    Raises:
        ValidationError: If the showtime does not match the expected model.
    """
    Showtime.model_validate(showtime)
    friends_going = [
        user_converters.to_public(friend)
        for friend in showtime_crud.get_friends_for_showtime(
            session=session,
            showtime_id=showtime.id,
            user_id=user_id,
            going_status=GoingStatus.GOING,
        )
    ]
    friends_interested = [
        user_converters.to_public(friend)
        for friend in showtime_crud.get_friends_for_showtime(
            session=session,
            showtime_id=showtime.id,
            user_id=user_id,
            going_status=GoingStatus.INTERESTED,
        )
        if friend.id not in [friend.id for friend in friends_going]
    ]
    going = user_crud.get_showtime_going_status(
        session=session,
        showtime_id=showtime.id,
        user_id=user_id,
    )
    cinema = cinema_converters.to_public(
        cinema=showtime.cinema,
    )

    return ShowtimeInMovieLoggedIn(
        **showtime.model_dump(),
        friends_going=friends_going,
        friends_interested=friends_interested,
        going=going,
        cinema=cinema,
    )
