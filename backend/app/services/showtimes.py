from datetime import timedelta
from uuid import UUID

from psycopg.errors import UniqueViolation
from sqlalchemy.exc import IntegrityError, MultipleResultsFound, NoResultFound
from sqlmodel import Session

from app.converters import showtime as showtime_converters
from app.core.cinema_seating import (
    CinemaSeatingPreset,
    normalize_cinema_seating_preset,
    validate_seat_for_preset,
)
from app.core.enums import GoingStatus
from app.crud import cinema_preset as cinema_presets_crud
from app.crud import friendship as friendship_crud
from app.crud import movie as movies_crud
from app.crud import showtime as showtimes_crud
from app.crud import showtime_ping as showtime_ping_crud
from app.crud import showtime_visibility as showtime_visibility_crud
from app.crud import user as user_crud
from app.exceptions.base import AppError
from app.exceptions.showtime_exceptions import (
    ShowtimeNotFoundError,
    ShowtimePingAlreadySelectedError,
    ShowtimePingAlreadySentError,
    ShowtimePingNonFriendError,
    ShowtimePingSelfError,
    ShowtimePingSenderAmbiguousError,
    ShowtimePingSenderNotFoundError,
    ShowtimeSeatValidationError,
)
from app.inputs.movie import Filters
from app.models.auth_schemas import Message
from app.models.showtime import Showtime, ShowtimeCreate
from app.schemas.showtime import ShowtimeLoggedIn
from app.schemas.showtime_visibility import ShowtimeVisibilityPublic
from app.services import push_notifications
from app.utils import now_amsterdam_naive


def _apply_upsert_update(
    *,
    existing_showtime: Showtime,
    showtime_create: ShowtimeCreate,
) -> None:
    existing_showtime.movie_id = showtime_create.movie_id
    existing_showtime.datetime = showtime_create.datetime
    existing_showtime.ticket_link = showtime_create.ticket_link
    if showtime_create.end_datetime is not None:
        existing_showtime.end_datetime = showtime_create.end_datetime
    if showtime_create.subtitles is not None:
        existing_showtime.subtitles = showtime_create.subtitles


def _apply_end_datetime_fallback(
    *,
    session: Session,
    showtime_create: ShowtimeCreate,
    existing_showtime: Showtime | None = None,
) -> None:
    if showtime_create.end_datetime is not None:
        return
    if existing_showtime is not None and existing_showtime.end_datetime is not None:
        return

    movie = movies_crud.get_movie_by_id(session=session, id=showtime_create.movie_id)
    if movie is None or movie.duration is None or movie.duration <= 0:
        return
    showtime_create.end_datetime = showtime_create.datetime + timedelta(
        minutes=movie.duration + 15
    )


def _normalize_seat_value(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    return normalized if normalized else None


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
    seat_row: str | None = None,
    seat_number: str | None = None,
    update_seat: bool = False,
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
        except ShowtimeSeatValidationError:
            # Seat validation errors happen before any write and should not roll back
            # unrelated caller-scoped transaction state.
            raise
        except AppError:
            session.rollback()
            raise
        except Exception as e:
            session.rollback()
            raise AppError from e
    else:
        try:
            showtime_for_validation = showtimes_crud.get_showtime_by_id(
                session=session,
                showtime_id=showtime_id,
            )
            if showtime_for_validation is None:
                raise ShowtimeNotFoundError(showtime_id)

            seating_preset = normalize_cinema_seating_preset(
                showtime_for_validation.cinema.seating
            )
            normalized_seat_row = _normalize_seat_value(seat_row)
            normalized_seat_number = _normalize_seat_value(seat_number)

            if going_status == GoingStatus.GOING:
                if update_seat:
                    try:
                        validate_seat_for_preset(
                            seating_preset=seating_preset,
                            seat_row=normalized_seat_row,
                            seat_number=normalized_seat_number,
                        )
                    except ValueError as e:
                        raise ShowtimeSeatValidationError(str(e))
                elif seating_preset == CinemaSeatingPreset.FREE.value:
                    # Clear any stale seat data if cinema seating is configured as free.
                    update_seat = True
                    normalized_seat_row = None
                    normalized_seat_number = None

            showtime = showtimes_crud.add_showtime_selection(
                session=session,
                showtime_id=showtime_id,
                user_id=user_id,
                going_status=going_status,
                seat_row=normalized_seat_row,
                seat_number=normalized_seat_number,
                update_seat=update_seat,
            )
            session.commit()
        except NoResultFound as e:
            session.rollback()
            raise ShowtimeNotFoundError(showtime_id) from e
        except AppError:
            session.rollback()
            raise
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
    showtime = _create_showtime_ping(
        session=session,
        showtime_id=showtime_id,
        sender_id=actor_id,
        receiver_id=friend_id,
        require_friendship=True,
    )

    push_notifications.notify_user_on_showtime_ping(
        session=session,
        sender_id=actor_id,
        receiver_id=friend_id,
        showtime=showtime,
    )
    return Message(message="Friend pinged successfully")


def receive_ping_from_link(
    *,
    session: Session,
    showtime_id: int,
    receiver_id: UUID,
    sender_identifier: str,
) -> Message:
    normalized_identifier = sender_identifier.strip()
    if not normalized_identifier:
        raise ShowtimePingSenderNotFoundError()

    sender_id: UUID
    try:
        sender_id = UUID(normalized_identifier)
        sender = user_crud.get_user_by_id(session=session, user_id=sender_id)
        if sender is None:
            raise ShowtimePingSenderNotFoundError()
    except ValueError:
        try:
            sender = user_crud.get_user_by_display_name(
                session=session,
                display_name=normalized_identifier,
            )
        except MultipleResultsFound as error:
            raise ShowtimePingSenderAmbiguousError() from error
        if sender is None:
            raise ShowtimePingSenderNotFoundError()
        sender_id = sender.id

    try:
        _create_showtime_ping(
            session=session,
            showtime_id=showtime_id,
            sender_id=sender_id,
            receiver_id=receiver_id,
            require_friendship=False,
        )
    except ShowtimePingAlreadySentError:
        # Opening the same shared link more than once should remain a no-op success.
        pass
    return Message(message="Ping received successfully")


def _create_showtime_ping(
    *,
    session: Session,
    showtime_id: int,
    sender_id: UUID,
    receiver_id: UUID,
    require_friendship: bool,
) -> Showtime:
    if sender_id == receiver_id:
        raise ShowtimePingSelfError()

    showtime = showtimes_crud.get_showtime_by_id(
        session=session, showtime_id=showtime_id
    )
    if showtime is None:
        raise ShowtimeNotFoundError(showtime_id)

    if require_friendship:
        is_friend = friendship_crud.are_users_friends(
            session=session,
            user_id=sender_id,
            friend_id=receiver_id,
        )
        if not is_friend:
            raise ShowtimePingNonFriendError()

    friend_status = user_crud.get_showtime_going_status(
        session=session,
        showtime_id=showtime_id,
        user_id=receiver_id,
    )
    if friend_status in (GoingStatus.GOING, GoingStatus.INTERESTED):
        friend_status_is_visible = (
            showtime_visibility_crud.is_showtime_visible_to_viewer_for_ids(
                session=session,
                owner_id=receiver_id,
                showtime_id=showtime_id,
                viewer_id=sender_id,
            )
        )
        if friend_status_is_visible:
            raise ShowtimePingAlreadySelectedError()

    existing_ping = showtime_ping_crud.get_showtime_ping(
        session=session,
        showtime_id=showtime_id,
        sender_id=sender_id,
        receiver_id=receiver_id,
    )
    if existing_ping is not None:
        raise ShowtimePingAlreadySentError()

    try:
        showtime_ping_crud.create_showtime_ping(
            session=session,
            showtime_id=showtime_id,
            sender_id=sender_id,
            receiver_id=receiver_id,
            created_at=now_amsterdam_naive(),
        )
        session.commit()
    except IntegrityError as e:
        session.rollback()
        if isinstance(e.orig, UniqueViolation):
            raise ShowtimePingAlreadySentError() from e
        raise AppError from e
    except Exception as e:
        session.rollback()
        raise AppError from e

    return showtime


def get_pinged_friend_ids_for_showtime(
    *,
    session: Session,
    showtime_id: int,
    actor_id: UUID,
) -> list[UUID]:
    showtime = showtimes_crud.get_showtime_by_id(
        session=session,
        showtime_id=showtime_id,
    )
    if showtime is None:
        raise ShowtimeNotFoundError(showtime_id)
    return showtime_ping_crud.get_pinged_friend_ids_for_showtime(
        session=session,
        showtime_id=showtime_id,
        sender_id=actor_id,
    )


def get_showtime_visibility(
    *,
    session: Session,
    showtime_id: int,
    actor_id: UUID,
) -> ShowtimeVisibilityPublic:
    showtime = showtimes_crud.get_showtime_by_id(
        session=session, showtime_id=showtime_id
    )
    if showtime is None:
        raise ShowtimeNotFoundError(showtime_id)

    friends = user_crud.get_friends(session=session, user_id=actor_id)
    all_friend_ids = sorted((friend.id for friend in friends), key=str)
    explicit_visible_friend_ids = (
        showtime_visibility_crud.get_visible_friend_ids_for_showtime(
            session=session,
            owner_id=actor_id,
            showtime_id=showtime_id,
        )
    )

    if explicit_visible_friend_ids is None:
        visible_friend_ids = all_friend_ids
        all_friends_selected = True
    else:
        visible_friend_ids = [
            friend_id
            for friend_id in all_friend_ids
            if friend_id in explicit_visible_friend_ids
        ]
        all_friends_selected = len(visible_friend_ids) == len(all_friend_ids)

    return ShowtimeVisibilityPublic(
        showtime_id=showtime_id,
        movie_id=showtime.movie_id,
        visible_friend_ids=visible_friend_ids,
        all_friends_selected=all_friends_selected,
    )


def update_showtime_visibility(
    *,
    session: Session,
    showtime_id: int,
    actor_id: UUID,
    visible_friend_ids: list[UUID],
) -> ShowtimeVisibilityPublic:
    showtime = showtimes_crud.get_showtime_by_id(
        session=session, showtime_id=showtime_id
    )
    if showtime is None:
        raise ShowtimeNotFoundError(showtime_id)

    friends = user_crud.get_friends(session=session, user_id=actor_id)
    all_friend_ids = {friend.id for friend in friends}
    normalized_visible_friend_ids = sorted(set(visible_friend_ids), key=str)
    invalid_friend_ids = [
        friend_id
        for friend_id in normalized_visible_friend_ids
        if friend_id not in all_friend_ids
    ]
    if invalid_friend_ids:
        raise ValueError("Visibility list contains users who are not your friends.")

    showtime_visibility_crud.set_visible_friend_ids_for_showtime(
        session=session,
        owner_id=actor_id,
        showtime_id=showtime_id,
        visible_friend_ids=normalized_visible_friend_ids,
        all_friend_ids=all_friend_ids,
        now=now_amsterdam_naive(),
    )
    session.commit()
    return get_showtime_visibility(
        session=session,
        showtime_id=showtime_id,
        actor_id=actor_id,
    )


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
    _apply_end_datetime_fallback(
        session=session,
        showtime_create=showtime_create,
        existing_showtime=existing_showtime,
    )

    if commit:
        if existing_showtime is not None:
            try:
                existing_showtime.datetime = showtime_create.datetime
                if showtime_create.end_datetime is not None:
                    existing_showtime.end_datetime = showtime_create.end_datetime
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
                if showtime_create.end_datetime is not None:
                    existing_showtime.end_datetime = showtime_create.end_datetime
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
    # Prefer exact unique match so metadata fallbacks (for example end_datetime)
    # can be applied on unchanged showtimes instead of hitting unique-violation
    # recovery paths that return the row without updates.
    existing_showtime = showtimes_crud.get_showtime_by_unique_fields(
        session=session,
        movie_id=showtime_create.movie_id,
        cinema_id=showtime_create.cinema_id,
        datetime=showtime_create.datetime,
    )
    if existing_showtime is None:
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
    _apply_end_datetime_fallback(
        session=session,
        showtime_create=showtime_create,
        existing_showtime=existing_showtime,
    )

    if commit:
        if existing_showtime is not None:
            try:
                _apply_upsert_update(
                    existing_showtime=existing_showtime,
                    showtime_create=showtime_create,
                )
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
                _apply_upsert_update(
                    existing_showtime=existing_showtime,
                    showtime_create=showtime_create,
                )
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
