from datetime import timedelta
from uuid import UUID

from psycopg.errors import UniqueViolation
from sqlalchemy.exc import IntegrityError, NoResultFound
from sqlmodel import Session

from app.converters import showtime as showtime_converters
from app.core.enums import GoingStatus
from app.crud import showtime as showtimes_crud
from app.exceptions.base import AppError
from app.exceptions.showtime_exceptions import (
    ShowtimeNotFoundError,
)
from app.inputs.movie import Filters
from app.models.showtime import ShowtimeCreate
from app.schemas.showtime import ShowtimeLoggedIn


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
    return showtime_logged_in


def insert_showtime_if_not_exists(
    *,
    session: Session,
    showtime_create: ShowtimeCreate,
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


def get_main_page_showtimes(
    *,
    session: Session,
    current_user_id: UUID,
    limit: int,
    offset: int,
    filters: Filters,
) -> list[ShowtimeLoggedIn]:
    showtimes = showtimes_crud.get_main_page_showtimes(
        session=session,
        user_id=current_user_id,
        limit=limit,
        offset=offset,
        filters=filters,
    )
    return [
        showtime_converters.to_logged_in(
            showtime=showtime, session=session, user_id=current_user_id, filters=filters
        )
        for showtime in showtimes
    ]
