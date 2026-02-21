from datetime import timedelta
from uuid import UUID

from psycopg.errors import UniqueViolation
from sqlalchemy.exc import IntegrityError, NoResultFound
from sqlmodel import Session

from app.converters import showtime as showtime_converters
from app.core.enums import GoingStatus
from app.crud import cinema_preset as cinema_presets_crud
from app.crud import friendship as friendship_crud
from app.crud import showtime as showtimes_crud
from app.crud import user as user_crud
from app.exceptions.base import AppError
from app.exceptions.showtime_exceptions import (
    ShowtimeNotFoundError,
    ShowtimePingAlreadySelectedError,
    ShowtimePingNonFriendError,
    ShowtimePingSelfError,
)
from app.inputs.movie import Filters
from app.models.auth_schemas import Message
from app.models.showtime import Showtime, ShowtimeCreate
from app.schemas.showtime import ShowtimeLoggedIn
from app.services import push_notifications


def get_showtime_by_id(
    *,
    session: Session,
    showtime_id: int,
    current_user: UUID,
    filters: Filters,
) -> ShowtimeLoggedIn:
    """
    Get a showtime by its ID for a logged-in user.

    Parameters:
        session (Session): Database session.
        showtime_id (int): ID of the showtime to retrieve.
        current_user (UUID): ID of the current user.
    Returns:
        ShowtimeLoggedIn: The showtime details for the logged-in user.
    Raises:
        ShowtimeNotFoundError: If the showtime with the given ID does not exist.
    """
    showtime = showtimes_crud.get_showtime_by_id(
        session=session,
        showtime_id=showtime_id,
    )
    if showtime is None:
        raise ShowtimeNotFoundError(showtime_id)
    showtime_public = showtime_converters.to_logged_in(
        showtime=showtime, session=session, user_id=current_user, filters=filters
    )
    return showtime_public


def update_showtime_selection(
    *,
    session: Session,
    showtime_id: int,
    user_id: UUID,
    going_status: GoingStatus,
    filters: Filters,
) -> ShowtimeLoggedIn:
    previous_status = user_crud.get_showtime_going_status(
        session=session,
        showtime_id=showtime_id,
        user_id=user_id,
    )
    if going_status == GoingStatus.NOT_GOING:
        try:
            showtime = showtimes_crud.remove_showtime_selection(
                session=session,
                showtime_id=showtime_id,
                user_id=user_id,
            )
            session.commit()
        except NoResultFound as e:
            session.rollback()
            raise ShowtimeNotFoundError(showtime_id) from e
        except Exception as e:
            session.rollback()
            raise AppError from e
    else:
        try:
            showtime = showtimes_crud.add_showtime_selection(
                session=session,
                showtime_id=showtime_id,
                user_id=user_id,
                going_status=going_status,
            )
            session.commit()
        except NoResultFound as e:
            session.rollback()
            raise ShowtimeNotFoundError(showtime_id) from e
        except Exception as e:
            session.rollback()
            raise AppError from e
    showtime_logged_in = showtime_converters.to_logged_in(
        showtime=showtime, session=session, user_id=user_id, filters=filters
    )

    if going_status != previous_status:
        push_notifications.notify_friends_on_showtime_selection(
            session=session,
            actor_id=user_id,
            showtime=showtime,
            previous_status=previous_status,
            going_status=going_status,
        )

    return showtime_logged_in


def ping_friend_for_showtime(
    *,
    session: Session,
    showtime_id: int,
    actor_id: UUID,
    friend_id: UUID,
) -> Message:
    if actor_id == friend_id:
        raise ShowtimePingSelfError()

    showtime = showtimes_crud.get_showtime_by_id(
        session=session, showtime_id=showtime_id
    )
    if showtime is None:
        raise ShowtimeNotFoundError(showtime_id)

    is_friend = friendship_crud.are_users_friends(
        session=session,
        user_id=actor_id,
        friend_id=friend_id,
    )
    if not is_friend:
        raise ShowtimePingNonFriendError()

    friend_status = user_crud.get_showtime_going_status(
        session=session,
        showtime_id=showtime_id,
        user_id=friend_id,
    )
    if friend_status in (GoingStatus.GOING, GoingStatus.INTERESTED):
        raise ShowtimePingAlreadySelectedError()

    push_notifications.notify_user_on_showtime_ping(
        session=session,
        sender_id=actor_id,
        receiver_id=friend_id,
        showtime=showtime,
    )
    return Message(message="Friend pinged successfully")


def insert_showtime_if_not_exists(
    *,
    session: Session,
    showtime_create: ShowtimeCreate,
    commit: bool = True,
) -> bool:
    """
    Insert a showtime into the database if it does not already exist.
    If there is a showtime with the same movie and cinema within 1 hour,
    assume its a time change and simply change the time of the existing showtime.

    Parameters:
        session (Session): Database session.
        showtime_create (ShowtimeCreate): Showtime data to insert.
    Returns:
        bool: True if the showtime was inserted/changed, False if it already exists.
    Raises:
        AppError: If there is an error during showtime insertion.
    """
    existing_showtime = showtimes_crud.get_showtime_close_in_time(
        session=session,
        showtime_create=showtime_create,
        delta=timedelta(hours=1),
    )

    if commit:
        if existing_showtime is not None:
            try:
                existing_showtime.datetime = showtime_create.datetime
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
            showtimes_crud.create_showtime(
                session=session,
                showtime_create=showtime_create,
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
            if existing_showtime is not None:
                existing_showtime.datetime = showtime_create.datetime
            else:
                showtimes_crud.create_showtime(
                    session=session,
                    showtime_create=showtime_create,
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


def upsert_showtime(
    *,
    session: Session,
    showtime_create: ShowtimeCreate,
    commit: bool = True,
) -> Showtime:
    """
    Insert or update a showtime and return the resulting database row.
    Uses the same +/-1h time-shift heuristic as insert_showtime_if_not_exists.
    If the only close match differs by movie_id (for example after a TMDB cache
    correction), reassign that existing showtime to the new movie_id.
    """
    existing_showtime = showtimes_crud.get_showtime_close_in_time(
        session=session,
        showtime_create=showtime_create,
        delta=timedelta(hours=1),
    )
    if existing_showtime is None:
        existing_showtime = showtimes_crud.get_showtime_reassignment_candidate(
            session=session,
            showtime_create=showtime_create,
            delta=timedelta(hours=1),
        )

    if commit:
        if existing_showtime is not None:
            try:
                existing_showtime.movie_id = showtime_create.movie_id
                existing_showtime.datetime = showtime_create.datetime
                existing_showtime.ticket_link = showtime_create.ticket_link
                session.commit()
                session.refresh(existing_showtime)
                return existing_showtime
            except IntegrityError as e:
                session.rollback()
                if isinstance(e.orig, UniqueViolation):
                    existing_exact = showtimes_crud.get_showtime_by_unique_fields(
                        session=session,
                        movie_id=showtime_create.movie_id,
                        cinema_id=showtime_create.cinema_id,
                        datetime=showtime_create.datetime,
                    )
                    if existing_exact is not None:
                        return existing_exact
                raise AppError from e
            except Exception as e:
                session.rollback()
                raise AppError from e

        try:
            showtime = showtimes_crud.create_showtime(
                session=session,
                showtime_create=showtime_create,
            )
            session.commit()
            session.refresh(showtime)
            return showtime
        except IntegrityError as e:
            session.rollback()
            if isinstance(e.orig, UniqueViolation):
                existing_exact = showtimes_crud.get_showtime_by_unique_fields(
                    session=session,
                    movie_id=showtime_create.movie_id,
                    cinema_id=showtime_create.cinema_id,
                    datetime=showtime_create.datetime,
                )
                if existing_exact is not None:
                    return existing_exact
            raise AppError from e
        except Exception as e:
            session.rollback()
            raise AppError from e

    try:
        with session.begin_nested():
            if existing_showtime is not None:
                existing_showtime.movie_id = showtime_create.movie_id
                existing_showtime.datetime = showtime_create.datetime
                existing_showtime.ticket_link = showtime_create.ticket_link
                session.flush()
                return existing_showtime

            showtime = showtimes_crud.create_showtime(
                session=session,
                showtime_create=showtime_create,
            )
            session.flush()
            return showtime
    except IntegrityError as e:
        if isinstance(e.orig, UniqueViolation):
            existing_exact = showtimes_crud.get_showtime_by_unique_fields(
                session=session,
                movie_id=showtime_create.movie_id,
                cinema_id=showtime_create.cinema_id,
                datetime=showtime_create.datetime,
            )
            if existing_exact is not None:
                return existing_exact
        raise AppError from e
    except Exception as e:
        raise AppError from e


def get_main_page_showtimes(
    *,
    session: Session,
    current_user_id: UUID,
    limit: int,
    offset: int,
    filters: Filters,
) -> list[ShowtimeLoggedIn]:
    if filters.selected_cinema_ids is None:
        favorite_preset = cinema_presets_crud.get_user_favorite_preset(
            session=session,
            user_id=current_user_id,
        )
        if favorite_preset is not None:
            filters.selected_cinema_ids = list(favorite_preset.cinema_ids)
        else:
            # Compatibility fallback for users still on legacy cinema selections.
            filters.selected_cinema_ids = user_crud.get_selected_cinemas_ids(
                session=session,
                user_id=current_user_id,
            )

    letterboxd_username = None
    if filters.watchlist_only:
        letterboxd_username = user_crud.get_letterboxd_username(
            session=session,
            user_id=current_user_id,
        )
    showtimes = showtimes_crud.get_main_page_showtimes(
        session=session,
        user_id=current_user_id,
        limit=limit,
        offset=offset,
        filters=filters,
        letterboxd_username=letterboxd_username,
    )
    return [
        showtime_converters.to_logged_in(
            showtime=showtime, session=session, user_id=current_user_id, filters=filters
        )
        for showtime in showtimes
    ]
