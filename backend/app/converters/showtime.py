from uuid import UUID

from sqlmodel import Session, col, select

from app.converters import cinema as cinema_converters
from app.converters import movie as movie_converters
from app.converters import user as user_converters
from app.core.enums import GoingStatus
from app.crud import friendship as friendship_crud
from app.crud import movie as movie_crud
from app.crud import showtime as showtime_crud
from app.crud import showtime_ping as showtime_ping_crud
from app.models.showtime import Showtime
from app.models.showtime_selection import ShowtimeSelection
from app.models.user import User
from app.schemas.showtime import ShowtimeInMovieLoggedIn, ShowtimeLoggedIn
from app.schemas.user import UserPublic


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


def _selection_status_and_seat(
    *,
    selection: ShowtimeSelection | None,
) -> tuple[GoingStatus, str | None, str | None]:
    if selection is None:
        return GoingStatus.NOT_GOING, None, None

    if selection.going_status != GoingStatus.GOING:
        return selection.going_status, None, None

    return selection.going_status, selection.seat_row, selection.seat_number


def _friends_for_showtime(
    *,
    session: Session,
    showtime_id: int,
    user_id: UUID,
) -> tuple[list, list]:
    friends_going_users = showtime_crud.get_friends_for_showtime(
        session=session,
        showtime_id=showtime_id,
        user_id=user_id,
        going_status=GoingStatus.GOING,
    )
    friends_going_selections = showtime_crud.get_showtime_selections_for_users(
        session=session,
        showtime_id=showtime_id,
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
            showtime_id=showtime_id,
            user_id=user_id,
            going_status=GoingStatus.INTERESTED,
        )
        if friend.id not in friend_going_ids
    ]
    return friends_going, friends_interested


def _invite_info_for_showtime(
    *,
    session: Session,
    showtime_id: int,
    user_id: UUID,
) -> tuple[list, list[int]]:
    """Unique senders + ping ids of the user's active received pings for a showtime."""
    pings = showtime_ping_crud.get_received_pings_for_showtime(
        session=session,
        showtime_id=showtime_id,
        receiver_id=user_id,
    )
    invited_by = []
    invite_ping_ids: list[int] = []
    seen_sender_ids: set[UUID] = set()
    for ping, sender in pings:
        if ping.id is not None:
            invite_ping_ids.append(ping.id)
        if sender.id not in seen_sender_ids:
            seen_sender_ids.add(sender.id)
            invited_by.append(user_converters.to_public(sender))
    return invited_by, invite_ping_ids


def _co_invited_friends(
    *,
    session: Session,
    showtime_id: int,
    user_id: UUID,
) -> list[UserPublic]:
    """Your friends who were also invited to this showtime by someone who invited you."""
    co_invited_ids = showtime_ping_crud.get_co_invited_user_ids(
        session=session,
        viewer_id=user_id,
        showtime_id=showtime_id,
    )
    if len(co_invited_ids) == 0:
        return []
    friend_ids = friendship_crud.get_friend_ids(session=session, user_id=user_id)
    visible_ids = co_invited_ids & friend_ids
    if len(visible_ids) == 0:
        return []
    users = session.exec(select(User).where(col(User.id).in_(visible_ids))).all()
    return [user_converters.to_public(user) for user in users]


def _pending_invited_friends(
    *,
    session: Session,
    showtime_id: int,
    user_id: UUID,
    responded_ids: set[UUID],
) -> list[UserPublic]:
    """Friends you invited who haven't responded going/interested yet."""
    rows = showtime_ping_crud.get_sent_showtime_pings(
        session=session,
        showtime_id=showtime_id,
        sender_id=user_id,
    )
    pending: list[UserPublic] = []
    for ping, display_name in rows:
        if ping.receiver_id in responded_ids:
            continue
        pending.append(
            UserPublic(
                id=ping.receiver_id,
                is_active=True,
                display_name=display_name,
            )
        )
    return pending


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
    Showtime.model_validate(showtime)
    friends_going, friends_interested = _friends_for_showtime(
        session=session,
        showtime_id=showtime.id,
        user_id=user_id,
    )
    current_selection = showtime_crud.get_showtime_selection(
        session=session,
        showtime_id=showtime.id,
        user_id=user_id,
    )
    going, seat_row, seat_number = _selection_status_and_seat(
        selection=current_selection
    )
    invited_by, invite_ping_ids = _invite_info_for_showtime(
        session=session,
        showtime_id=showtime.id,
        user_id=user_id,
    )
    movie = movie_converters.to_in_showtime(showtime.movie)
    cinema = cinema_converters.to_public(
        cinema=showtime.cinema,
    )
    friends_watchlisted = [
        user_converters.to_public(friend)
        for friend in movie_crud.get_friends_who_watchlisted_movie(
            session=session,
            movie_id=showtime.movie_id,
            current_user=user_id,
        )
    ]
    friends_watched = [
        user_converters.to_public(friend)
        for friend in movie_crud.get_friends_who_watched_movie(
            session=session,
            movie_id=showtime.movie_id,
            current_user=user_id,
        )
    ]
    responded_ids = {friend.id for friend in friends_going} | {
        friend.id for friend in friends_interested
    }
    co_invited_friends = _co_invited_friends(
        session=session, showtime_id=showtime.id, user_id=user_id
    )
    pending_invited_friends = _pending_invited_friends(
        session=session,
        showtime_id=showtime.id,
        user_id=user_id,
        responded_ids=responded_ids,
    )

    return ShowtimeLoggedIn(
        **showtime.model_dump(),
        friends_going=friends_going,
        friends_interested=friends_interested,
        going=going,
        seat_row=seat_row,
        seat_number=seat_number,
        movie=movie,
        cinema=cinema,
        invited_by=invited_by,
        invite_ping_ids=invite_ping_ids,
        co_invited_friends=co_invited_friends,
        pending_invited_friends=pending_invited_friends,
        friends_watchlisted=friends_watchlisted,
        friends_watched=friends_watched,
    )


def to_in_movie_logged_in(
    showtime: Showtime,
    *,
    session: Session,
    user_id: UUID,
) -> ShowtimeInMovieLoggedIn:
    """
    Converts a Showtime object to a ShowtimeInMovieLoggedIn object, including
    viewer status and related cinema details.

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
    friends_going, friends_interested = _friends_for_showtime(
        session=session,
        showtime_id=showtime.id,
        user_id=user_id,
    )
    current_selection = showtime_crud.get_showtime_selection(
        session=session,
        showtime_id=showtime.id,
        user_id=user_id,
    )
    going, seat_row, seat_number = _selection_status_and_seat(
        selection=current_selection
    )
    invited_by, invite_ping_ids = _invite_info_for_showtime(
        session=session,
        showtime_id=showtime.id,
        user_id=user_id,
    )
    cinema = cinema_converters.to_public(
        cinema=showtime.cinema,
    )
    responded_ids = {friend.id for friend in friends_going} | {
        friend.id for friend in friends_interested
    }
    co_invited_friends = _co_invited_friends(
        session=session, showtime_id=showtime.id, user_id=user_id
    )
    pending_invited_friends = _pending_invited_friends(
        session=session,
        showtime_id=showtime.id,
        user_id=user_id,
        responded_ids=responded_ids,
    )

    return ShowtimeInMovieLoggedIn(
        **showtime.model_dump(),
        friends_going=friends_going,
        friends_interested=friends_interested,
        going=going,
        seat_row=seat_row,
        seat_number=seat_number,
        cinema=cinema,
        invited_by=invited_by,
        invite_ping_ids=invite_ping_ids,
        co_invited_friends=co_invited_friends,
        pending_invited_friends=pending_invited_friends,
    )
