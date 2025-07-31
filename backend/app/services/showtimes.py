from uuid import UUID

from psycopg.errors import ForeignKeyViolation, UniqueViolation
from sqlalchemy.exc import IntegrityError, NoResultFound
from sqlmodel import Session

from app.converters import showtime as showtime_converters
from app.crud import showtime as showtimes_crud
from app.crud import user as users_crud
from app.exceptions.base import AppError
from app.exceptions.showtime_exceptions import (
    ShowtimeAlreadySelectedError,
    ShowtimeNotFoundError,
    ShowtimeOrUserNotFoundError,
    ShowtimeSelectionNotFoundError,
)
from app.models.showtime import ShowtimeCreate
from app.schemas.showtime import ShowtimeLoggedIn


def get_showtime_by_id(
    *,
    session: Session,
    showtime_id: int,
    current_user: UUID,
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
        showtime=showtime,
        session=session,
        user_id=current_user,
    )
    return showtime_public


def select_showtime(
    *,
    session: Session,
    showtime_id: int,
    user_id: UUID,
) -> ShowtimeLoggedIn:
    """
    Select a showtime for a user.

    Parameters:
        session (Session): Database session.
        showtime_id (int): ID of the showtime to select.
        user_id (UUID): ID of the user selecting the showtime.
    Returns:
        ShowtimeLoggedIn: The showtime details for the logged-in user.
    Raises:
        ShowtimeAlreadySelectedError: If the showtime is already selected by the user.
        ShowtimeOrUserNotFoundError: If the showtime or user does not exist.
        AppError: For other unexpected errors.
    """
    try:
        showtime = users_crud.add_showtime_selection(
            session=session,
            showtime_id=showtime_id,
            user_id=user_id,
        )
        session.commit()
    except IntegrityError as e:
        session.rollback()
        if isinstance(e.orig, UniqueViolation):
            raise ShowtimeAlreadySelectedError(showtime_id, user_id) from e
        elif isinstance(e.orig, ForeignKeyViolation):
            raise ShowtimeOrUserNotFoundError(showtime_id, user_id) from e
        else:
            raise AppError from e
    except Exception as e:
        session.rollback()
        raise AppError from e

    showtime_logged_in = showtime_converters.to_logged_in(
        showtime=showtime,
        session=session,
        user_id=user_id,
    )
    return showtime_logged_in


def delete_showtime_selection(
    *,
    session: Session,
    showtime_id: int,
    user_id: UUID,
) -> ShowtimeLoggedIn:
    """
    Delete a user's selection of a showtime.

    Parameters:
        session (Session): Database session.
        showtime_id (int): ID of the showtime to delete selection for.
        user_id (UUID): ID of the user whose selection is being deleted.
    Returns:
        ShowtimeLoggedIn: The showtime details for the logged-in user after deletion.
    Raises:
        ShowtimeSelectionNotFoundError: If the showtime selection does not exist.
        AppError: For other unexpected errors.
    """
    try:
        showtime = users_crud.delete_showtime_selection(
            session=session,
            showtime_id=showtime_id,
            user_id=user_id,
        )
        session.commit()
    except NoResultFound as e:
        session.rollback()
        raise ShowtimeSelectionNotFoundError(showtime_id, user_id) from e
    except Exception as e:
        session.rollback()
        raise AppError from e

    showtime_logged_in = showtime_converters.to_logged_in(
        showtime=showtime,
        session=session,
        user_id=user_id,
    )
    return showtime_logged_in


def toggle_showtime_selection(
    *,
    session: Session,
    showtime_id: int,
    user_id: UUID,
) -> ShowtimeLoggedIn:
    """
    Toggle a user's selection of a showtime. If the user has already selected the showtime,
    it will be removed; otherwise, it will be added.

    Parameters:
        session (Session): Database session.
        showtime_id (int): ID of the showtime to toggle selection for.
        user_id (UUID): ID of the user whose selection is being toggled.
    Returns:
        ShowtimeLoggedIn: The showtime details for the logged-in user after toggling selection.
    Raises:
        ShowtimeOrUserNotFoundError: If the showtime or user does not exist.
        AppError: For other unexpected errors.
    """
    is_going = users_crud.has_user_selected_showtime(
        session=session,
        showtime_id=showtime_id,
        user_id=user_id,
    )

    if is_going:
        return delete_showtime_selection(
            session=session,
            showtime_id=showtime_id,
            user_id=user_id,
        )
    else:
        return select_showtime(
            session=session,
            showtime_id=showtime_id,
            user_id=user_id,
        )


def insert_showtime_if_not_exists(
    *,
    session: Session,
    showtime_create: ShowtimeCreate,
) -> bool:
    """
    Insert a showtime into the database if it does not already exist.

    Parameters:
        session (Session): Database session.
        showtime_create (ShowtimeCreate): Showtime data to insert.
    Returns:
        bool: True if the showtime was inserted, False if it already exists.
    Raises:
        AppError: If there is an error during showtime insertion.
    """
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
