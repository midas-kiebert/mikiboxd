from uuid import UUID

from sqlmodel import Session

from app.converters import cinema as cinema_converters
from app.converters import movie as movie_converters
from app.converters import user as user_converters
from app.core.enums import GoingStatus
from app.crud import showtime as showtime_crud
from app.crud import user as user_crud
from app.inputs.movie import Filters
from app.models.showtime import Showtime
from app.models.showtime_selection import ShowtimeSelection
from app.models.user import User
from app.schemas.showtime import ShowtimeInMovieLoggedIn, ShowtimeLoggedIn
from app.utils import now_amsterdam_naive


def _friend_to_public_with_seat(
    *,
    friend: User,
    selection_by_user_id: dict[UUID, ShowtimeSelection],
):
    selection = selection_by_user_id.get(friend.id)
    return user_converters.to_public(
        friend,
        seat_row=selection.seat_row if selection is not None else None,
        seat_number=selection.seat_number if selection is not None else None,
    )


def to_logged_in(
    showtime: Showtime,
    *,
    session: Session,
    user_id: UUID,
    filters: Filters,
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
    filters.snapshot_time = now_amsterdam_naive()
    Showtime.model_validate(showtime)
    friends_going_users = showtime_crud.get_friends_for_showtime(
        session=session,
        showtime_id=showtime.id,
        user_id=user_id,
        going_status=GoingStatus.GOING,
    )
    friends_going_selections = showtime_crud.get_showtime_selections_for_users(
        session=session,
        showtime_id=showtime.id,
        user_ids=[friend.id for friend in friends_going_users],
    )
    friends_going = [
        _friend_to_public_with_seat(
            friend=friend,
            selection_by_user_id=friends_going_selections,
        )
        for friend in friends_going_users
    ]
    friend_going_ids = {friend.id for friend in friends_going}
    friends_interested = [
        user_converters.to_public(friend)
        for friend in showtime_crud.get_friends_for_showtime(
            session=session,
            showtime_id=showtime.id,
            user_id=user_id,
            going_status=GoingStatus.INTERESTED,
        )
        if friend.id not in friend_going_ids
    ]
    going = user_crud.get_showtime_going_status(
        session=session,
        showtime_id=showtime.id,
        user_id=user_id,
    )
    current_selection = showtime_crud.get_showtime_selection(
        session=session,
        showtime_id=showtime.id,
        user_id=user_id,
    )
    seat_row = (
        current_selection.seat_row
        if current_selection is not None
        and current_selection.going_status == GoingStatus.GOING
        else None
    )
    seat_number = (
        current_selection.seat_number
        if current_selection is not None
        and current_selection.going_status == GoingStatus.GOING
        else None
    )
    movie_summary = movie_converters.to_summary_logged_in(
        movie=showtime.movie,
        session=session,
        current_user=user_id,
        filters=filters,
    )
    cinema = cinema_converters.to_public(
        cinema=showtime.cinema,
    )

    return ShowtimeLoggedIn(
        **showtime.model_dump(),
        friends_going=friends_going,
        friends_interested=friends_interested,
        going=going,
        seat_row=seat_row,
        seat_number=seat_number,
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
    friends_going_users = showtime_crud.get_friends_for_showtime(
        session=session,
        showtime_id=showtime.id,
        user_id=user_id,
        going_status=GoingStatus.GOING,
    )
    friends_going_selections = showtime_crud.get_showtime_selections_for_users(
        session=session,
        showtime_id=showtime.id,
        user_ids=[friend.id for friend in friends_going_users],
    )
    friends_going = [
        _friend_to_public_with_seat(
            friend=friend,
            selection_by_user_id=friends_going_selections,
        )
        for friend in friends_going_users
    ]
    friend_going_ids = {friend.id for friend in friends_going}
    friends_interested = [
        user_converters.to_public(friend)
        for friend in showtime_crud.get_friends_for_showtime(
            session=session,
            showtime_id=showtime.id,
            user_id=user_id,
            going_status=GoingStatus.INTERESTED,
        )
        if friend.id not in friend_going_ids
    ]
    going = user_crud.get_showtime_going_status(
        session=session,
        showtime_id=showtime.id,
        user_id=user_id,
    )
    current_selection = showtime_crud.get_showtime_selection(
        session=session,
        showtime_id=showtime.id,
        user_id=user_id,
    )
    seat_row = (
        current_selection.seat_row
        if current_selection is not None
        and current_selection.going_status == GoingStatus.GOING
        else None
    )
    seat_number = (
        current_selection.seat_number
        if current_selection is not None
        and current_selection.going_status == GoingStatus.GOING
        else None
    )
    cinema = cinema_converters.to_public(
        cinema=showtime.cinema,
    )

    return ShowtimeInMovieLoggedIn(
        **showtime.model_dump(),
        friends_going=friends_going,
        friends_interested=friends_interested,
        going=going,
        seat_row=seat_row,
        seat_number=seat_number,
        cinema=cinema,
    )
