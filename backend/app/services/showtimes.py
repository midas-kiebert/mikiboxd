import secrets
from datetime import timedelta
from uuid import UUID

from psycopg.errors import UniqueViolation
from sqlalchemy.exc import IntegrityError, NoResultFound
from sqlmodel import Session

from app.converters import showtime as showtime_converters
from app.converters import user as user_converters
from app.core.enums import GoingStatus, VisibilityMode
from app.core.viewer import ViewerId
from app.crud import friendship as friendship_crud
from app.crud import movie as movies_crud
from app.crud import showtime as showtimes_crud
from app.crud import showtime_ping as showtime_ping_crud
from app.crud import showtime_ping_link as showtime_ping_link_crud
from app.crud import showtime_visibility as showtime_visibility_crud
from app.crud import user as user_crud
from app.exceptions.base import AppError
from app.exceptions.moderation_exceptions import UserBlockedError
from app.exceptions.showtime_exceptions import (
    ShowtimeNotFoundError,
    ShowtimePingAlreadySentError,
    ShowtimePingInvalidLinkError,
    ShowtimePingNonFriendError,
    ShowtimePingPastShowtimeError,
    ShowtimePingSelfError,
    ShowtimeReminderNonFriendError,
    ShowtimeReminderNotEligibleError,
    ShowtimeSeatValidationError,
)
from app.inputs.movie import Filters
from app.models.auth_schemas import Message
from app.models.showtime import Showtime, ShowtimeCreate
from app.schemas.showtime import ShowtimePublic
from app.schemas.showtime_ping import SentShowtimePingPublic, ShowtimePingLinkToken
from app.schemas.showtime_visibility import (
    ShowtimeVisibilityPublic,
    UninvitedSelectedFriendsPublic,
)
from app.services import moderation as moderation_service
from app.services import push_notifications, showtime_title_conflict, viewer_context
from app.services import seat_availability as seat_availability_service
from app.utils import now_amsterdam_naive
from app.validators.cinema_seating import CinemaSeatingPreset, validate_seat_for_preset


def _apply_upsert_update(
    *,
    existing_showtime: Showtime,
    showtime_create: ShowtimeCreate,
) -> None:
    existing_showtime.movie_id = showtime_create.movie_id
    existing_showtime.tmdb_cache_id = showtime_create.tmdb_cache_id
    existing_showtime.datetime = showtime_create.datetime
    existing_showtime.ticket_link = showtime_create.ticket_link
    if showtime_create.end_datetime is not None:
        existing_showtime.end_datetime = showtime_create.end_datetime
    if showtime_create.subtitles is not None:
        existing_showtime.subtitles = showtime_create.subtitles
    # Only some sources name the room, and the seat availability poller fills it
    # in for the rest — so a scrape that does not know it must leave what is
    # already there alone rather than blanking it on every run.
    if showtime_create.room is not None:
        existing_showtime.room = showtime_create.room


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


def _find_conflicting_cinema_scraper_showtime(
    *,
    session: Session,
    showtime_create: ShowtimeCreate,
) -> Showtime | None:
    movie = movies_crud.get_movie_by_id(session=session, id=showtime_create.movie_id)
    if movie is None:
        return None
    return showtime_title_conflict.find_conflicting_cinema_scraper_showtime(
        session=session,
        cinema_id=showtime_create.cinema_id,
        showtime_datetime=showtime_create.datetime,
        movie_id=showtime_create.movie_id,
        movie_title=movie.title,
    )


def _normalize_seat_value(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    return normalized if normalized else None


def _apply_showtime_visibility_mode_for_owner(
    *,
    session: Session,
    showtime_id: int,
    owner_id: UUID,
    mode: VisibilityMode,
) -> None:
    showtime_visibility_crud.set_visibility_mode_for_showtime(
        session=session,
        owner_id=owner_id,
        showtime_id=showtime_id,
        mode=mode,
        now=now_amsterdam_naive(),
    )


def get_showtime_by_id(
    *,
    session: Session,
    showtime_id: int,
    current_user: ViewerId,
) -> ShowtimePublic:
    """
    Get a showtime by its ID, annotated for the requesting viewer.

    Parameters:
        session (Session): Database session.
        showtime_id (int): ID of the showtime to retrieve.
        current_user (ViewerId): Who to annotate for; None for an anonymous
            visitor — see `app.core.viewer`.
    Returns:
        ShowtimePublic: The showtime details for the requesting viewer.
    Raises:
        ShowtimeNotFoundError: If the showtime with the given ID does not exist.
    """
    showtime = showtimes_crud.get_showtime_by_id(
        session=session,
        showtime_id=showtime_id,
    )
    if showtime is None:
        raise ShowtimeNotFoundError(showtime_id)
    showtime_public = showtime_converters.to_public(
        showtime=showtime, session=session, user_id=current_user
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
    visibility_mode: VisibilityMode | None = None,
    update_seat: bool = False,
) -> ShowtimePublic:
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

            seating = showtime_for_validation.cinema.seating
            normalized_seat_row = _normalize_seat_value(seat_row)
            normalized_seat_number = _normalize_seat_value(seat_number)

            if going_status == GoingStatus.GOING:
                if update_seat:
                    try:
                        validate_seat_for_preset(
                            seating_preset=seating,
                            seat_row=normalized_seat_row,
                            seat_number=normalized_seat_number,
                        )
                    except ValueError as e:
                        raise ShowtimeSeatValidationError(str(e))
                elif seating == CinemaSeatingPreset.FREE:
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
            if visibility_mode is not None:
                _apply_showtime_visibility_mode_for_owner(
                    session=session,
                    showtime_id=showtime_id,
                    owner_id=user_id,
                    mode=visibility_mode,
                )
            # Caring about a showtime is what makes its seat count worth
            # knowing. A never-read showtime is already top of the poller's
            # queue the moment a selection exists; this is for the one that was
            # read hours ago and is sitting out a long cooldown. Queues only —
            # the poller does the requesting, with its own caps, so a user
            # working through a long list cannot become a burst of traffic.
            seat_availability_service.request_reading_on_interest(
                session=session, showtime_id=showtime_id
            )
            session.commit()
        except NoResultFound as e:
            session.rollback()
            raise ShowtimeNotFoundError(showtime_id) from e
        except ValueError:
            session.rollback()
            raise
        except AppError:
            session.rollback()
            raise
        except Exception as e:
            session.rollback()
            raise AppError from e
    showtime_logged_in = showtime_converters.to_public(
        showtime=showtime, session=session, user_id=user_id
    )

    if going_status != previous_status:
        push_notifications.notify_friends_on_showtime_selection(
            session=session,
            actor_id=user_id,
            showtime=showtime,
            previous_status=previous_status,
            going_status=going_status,
        )
        push_notifications.notify_inviters_on_response(
            session=session,
            responder_id=user_id,
            showtime=showtime,
            new_status=going_status,
        )

    return showtime_logged_in


def ping_friend_for_showtime(
    *,
    session: Session,
    showtime_id: int,
    actor_id: UUID,
    friend_id: UUID,
) -> tuple[Message, int, bool]:
    """Create the ping and return (message, ping_id, should_notify).

    The caller is responsible for scheduling the push notification as a
    background task so the sender has a 5-second window to uninvite before
    the notification fires. `should_notify` is False when the friend already
    had a selection before this ping — they already know, and this ping
    grants no extra visibility, so it isn't a "real" invite to announce.
    """
    _create_showtime_ping(
        session=session,
        showtime_id=showtime_id,
        sender_id=actor_id,
        receiver_id=friend_id,
        require_friendship=True,
    )
    ping = showtime_ping_crud.get_showtime_ping(
        session=session,
        showtime_id=showtime_id,
        sender_id=actor_id,
        receiver_id=friend_id,
    )
    assert ping is not None and ping.id is not None
    should_notify = not ping.receiver_had_selection_at_creation
    return Message(message="Friend invited successfully"), ping.id, should_notify


def send_showtime_reminder(
    *,
    session: Session,
    showtime_id: int,
    actor_id: UUID,
    friend_id: UUID,
) -> bool:
    """Nudge a friend already GOING/INTERESTED, or invited and not dismissed.

    Unlike `ping_friend_for_showtime`, this never creates or changes a
    selection or ping row — it's a one-off notification, not an invite.
    Returns whether a notification was actually dispatched: `False` (not an
    error) when the friend has `notify_on_showtime_reminder` turned off,
    since the mobile app already hides the button in that case and a sender
    who reaches this endpoint anyway (a stale friend list, a race) gets a
    quiet no-op rather than a message implying something is broken.
    """
    if actor_id == friend_id:
        raise ShowtimePingSelfError()

    if not friendship_crud.are_users_friends(
        session=session, user_id=actor_id, friend_id=friend_id
    ):
        raise ShowtimeReminderNonFriendError()

    if moderation_service.is_contact_blocked(
        session=session, user_id=actor_id, other_id=friend_id
    ):
        raise UserBlockedError

    showtime = showtimes_crud.get_showtime_by_id(
        session=session, showtime_id=showtime_id
    )
    if showtime is None:
        raise ShowtimeNotFoundError(showtime_id)

    friend_status = user_crud.get_showtime_going_status(
        session=session, showtime_id=showtime_id, user_id=friend_id
    )
    is_interested_or_going = friend_status in (
        GoingStatus.GOING,
        GoingStatus.INTERESTED,
    )
    has_active_invite = bool(
        showtime_ping_crud.get_active_received_inviter_ids(
            session=session, receiver_id=friend_id, showtime_id=showtime_id
        )
    )
    if not is_interested_or_going and not has_active_invite:
        raise ShowtimeReminderNotEligibleError()

    return push_notifications.notify_user_on_showtime_reminder(
        session=session,
        sender_id=actor_id,
        receiver_id=friend_id,
        showtime_id=showtime_id,
    )


_PING_LINK_TOKEN_BYTES = 12  # ~16 url-safe chars, 96 bits — short but unguessable
_PING_LINK_TOKEN_CREATE_ATTEMPTS = 5


def create_showtime_ping_link_token(
    *,
    session: Session,
    showtime_id: int,
    sender_id: UUID,
) -> ShowtimePingLinkToken:
    """Mint the short code embedded in a shared `/ping/{showtime_id}/{token}` link.

    A random code looked up server-side, rather than a self-contained signed
    token: it keeps the shared URL short (long URLs lose their WhatsApp/
    iMessage rich preview and print as raw text instead) while still binding
    the link to the user actually sharing it, so `receive_ping_from_link` can
    trust the sender it names — see that function's docstring for why that
    matters.
    """
    showtime = showtimes_crud.get_showtime_by_id(
        session=session, showtime_id=showtime_id
    )
    if showtime is None:
        raise ShowtimeNotFoundError(showtime_id)

    for _ in range(_PING_LINK_TOKEN_CREATE_ATTEMPTS):
        token = secrets.token_urlsafe(_PING_LINK_TOKEN_BYTES)
        try:
            showtime_ping_link_crud.create_showtime_ping_link(
                session=session,
                token=token,
                showtime_id=showtime_id,
                sender_id=sender_id,
            )
            session.commit()
            return ShowtimePingLinkToken(token=token)
        except IntegrityError as e:
            session.rollback()
            if not isinstance(e.orig, UniqueViolation):
                raise AppError from e
    raise AppError("Could not generate a unique invite link token.")


def receive_ping_from_link(
    *,
    session: Session,
    showtime_id: int,
    receiver_id: UUID,
    token: str,
) -> Message:
    """Record the invite carried by a shared link, once its token checks out.

    The token is minted by `create_showtime_ping_link_token` at share time and
    looked up here, so the sender it names is provably the person who
    generated the link — unlike a raw user ID or display name in the URL,
    which anyone could substitute to fabricate an invite from someone who
    never sent one.
    """
    link = showtime_ping_link_crud.get_showtime_ping_link(session=session, token=token)
    if link is None or link.showtime_id != showtime_id:
        raise ShowtimePingInvalidLinkError()
    # No separate "sender not found" check: the row's FK (ON DELETE CASCADE)
    # guarantees that as long as the link exists, its sender still does too —
    # deleting the sender's account deletes their minted links with it.
    sender_id = link.sender_id

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
    return Message(message="Invite received successfully")


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

    # Checked here rather than in the two callers so it covers both a direct
    # invite and one carried by a shared link — an invite is contact, and a
    # block has to stop all of it. Symmetric: see services/moderation.py.
    if moderation_service.is_contact_blocked(
        session=session, user_id=sender_id, other_id=receiver_id
    ):
        raise UserBlockedError

    showtime = showtimes_crud.get_showtime_by_id(
        session=session, showtime_id=showtime_id
    )
    if showtime is None:
        raise ShowtimeNotFoundError(showtime_id)

    # Invite links stay valid forever once shared, so an old one must not still
    # be able to create a ping for a screening that has already started.
    if showtime.datetime < now_amsterdam_naive():
        raise ShowtimePingPastShowtimeError()

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
    # A friend who is already going/interested can still be invited — it just
    # doesn't count as an "accepted" invite (see receiver_had_selection_at_creation),
    # so it grants no extra visibility and isn't notified.
    receiver_had_selection_at_creation = friend_status in (
        GoingStatus.GOING,
        GoingStatus.INTERESTED,
    )

    existing_ping = showtime_ping_crud.get_showtime_ping(
        session=session,
        showtime_id=showtime_id,
        sender_id=sender_id,
        receiver_id=receiver_id,
    )
    if existing_ping is not None:
        raise ShowtimePingAlreadySentError()

    sender_status = user_crud.get_showtime_going_status(
        session=session,
        showtime_id=showtime_id,
        user_id=sender_id,
    )

    try:
        showtime_ping_crud.create_showtime_ping(
            session=session,
            showtime_id=showtime_id,
            sender_id=sender_id,
            receiver_id=receiver_id,
            created_at=now_amsterdam_naive(),
            receiver_had_selection_at_creation=receiver_had_selection_at_creation,
        )
        if sender_status != GoingStatus.GOING:
            # Sending an invite implies interest, unless the sender is
            # already going.
            showtimes_crud.add_showtime_selection(
                session=session,
                showtime_id=showtime_id,
                user_id=sender_id,
                going_status=GoingStatus.INTERESTED,
            )
        # A new ping reshapes the whole invite group's visibility (endpoints,
        # co-invitees, and invitees inheriting the inviter's privacy).
        showtime_visibility_crud.rebuild_effective_visibility_for_showtime_participants(
            session=session,
            showtime_id=showtime_id,
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


def get_sent_pings_for_showtime(
    *,
    session: Session,
    showtime_id: int,
    actor_id: UUID,
) -> list[SentShowtimePingPublic]:
    if (
        showtimes_crud.get_showtime_by_id(session=session, showtime_id=showtime_id)
        is None
    ):
        raise ShowtimeNotFoundError(showtime_id)
    rows = showtime_ping_crud.get_sent_showtime_pings(
        session=session,
        showtime_id=showtime_id,
        sender_id=actor_id,
    )
    return [
        SentShowtimePingPublic(
            id=ping.id,  # type: ignore[arg-type]
            receiver_id=ping.receiver_id,
            receiver_name=display_name or "Friend",
            created_at=ping.created_at,
            seen_at=ping.seen_at,
            dismissed_at=ping.dismissed_at,
        )
        for ping, display_name in rows
    ]


def uninvite_friend_from_showtime(
    *,
    session: Session,
    showtime_id: int,
    actor_id: UUID,
    friend_id: UUID,
) -> bool:
    if (
        showtimes_crud.get_showtime_by_id(session=session, showtime_id=showtime_id)
        is None
    ):
        raise ShowtimeNotFoundError(showtime_id)
    deleted = showtime_ping_crud.delete_sent_showtime_ping(
        session=session,
        showtime_id=showtime_id,
        sender_id=actor_id,
        receiver_id=friend_id,
    )
    if deleted:
        try:
            # Removing the ping may drop visibility edges across the invite group.
            # Rebuild remaining participants plus the two now-detached endpoints.
            showtime_visibility_crud.rebuild_effective_visibility_for_showtime_participants(
                session=session,
                showtime_id=showtime_id,
            )
            showtime_visibility_crud.rebuild_effective_visibility_for_showtime(
                session=session,
                owner_id=actor_id,
                showtime_id=showtime_id,
            )
            showtime_visibility_crud.rebuild_effective_visibility_for_showtime(
                session=session,
                owner_id=friend_id,
                showtime_id=showtime_id,
            )
            session.commit()
        except Exception as e:
            session.rollback()
            raise AppError from e
    return deleted


def get_showtime_visibility_batch(
    *,
    session: Session,
    showtime_ids: list[int],
    actor_id: UUID,
) -> list[ShowtimeVisibilityPublic]:
    if len(showtime_ids) == 0:
        return []

    # Deduplicate while preserving the caller's order.
    deduped_showtime_ids = list(dict.fromkeys(showtime_ids))
    showtimes_by_id = showtimes_crud.get_showtimes_by_ids(
        session=session,
        showtime_ids=deduped_showtime_ids,
    )
    if len(showtimes_by_id) == 0:
        return []

    settings_by_showtime_id = (
        showtime_visibility_crud.get_showtime_visibility_settings_for_showtimes(
            session=session,
            owner_id=actor_id,
            showtime_ids=deduped_showtime_ids,
        )
    )
    # Resolved for the whole batch at once — a per-showtime lookup here would
    # make prefetching a list of showtimes O(n) queries.
    default_modes_by_showtime_id = (
        showtime_visibility_crud.get_owner_default_modes_for_showtimes(
            session=session,
            owner_id=actor_id,
            showtime_ids=deduped_showtime_ids,
        )
    )

    visibility_payload: list[ShowtimeVisibilityPublic] = []
    for showtime_id in deduped_showtime_ids:
        showtime = showtimes_by_id.get(showtime_id)
        if showtime is None:
            continue

        setting = settings_by_showtime_id.get(showtime_id)
        mode = (
            setting.mode
            if setting is not None
            else default_modes_by_showtime_id[showtime_id]
        )
        visibility_payload.append(
            ShowtimeVisibilityPublic(
                showtime_id=showtime_id,
                movie_id=showtime.movie_id,
                mode=mode,
            )
        )

    return visibility_payload


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

    setting = showtime_visibility_crud.get_showtime_visibility_setting(
        session=session,
        owner_id=actor_id,
        showtime_id=showtime_id,
    )
    mode = (
        setting.mode
        if setting is not None
        else showtime_visibility_crud.get_owner_default_mode_for_showtime(
            session=session,
            owner_id=actor_id,
            showtime_id=showtime_id,
        )
    )

    return ShowtimeVisibilityPublic(
        showtime_id=showtime_id,
        movie_id=showtime.movie_id,
        mode=mode,
    )


def get_uninvited_selected_friends_for_showtime(
    *,
    session: Session,
    showtime_id: int,
    actor_id: UUID,
) -> UninvitedSelectedFriendsPublic:
    """Friends already going/interested but not yet ping-connected to the actor.

    Used by the mobile client to warn before switching to INVITED_ONLY: these
    friends can currently see the actor's status and would otherwise silently
    lose that visibility, since they were never invited or inviting.
    """
    showtime = showtimes_crud.get_showtime_by_id(
        session=session, showtime_id=showtime_id
    )
    if showtime is None:
        raise ShowtimeNotFoundError(showtime_id)

    friend_ids = (
        showtime_visibility_crud.get_uninvited_selected_friend_ids_for_showtime(
            session=session,
            owner_id=actor_id,
            showtime_id=showtime_id,
        )
    )
    friends = user_crud.get_users_by_ids(session=session, user_ids=friend_ids)
    return UninvitedSelectedFriendsPublic(
        friends=[user_converters.to_public(friend) for friend in friends]
    )


def update_showtime_visibility(
    *,
    session: Session,
    showtime_id: int,
    actor_id: UUID,
    mode: VisibilityMode,
) -> ShowtimeVisibilityPublic:
    showtime = showtimes_crud.get_showtime_by_id(
        session=session, showtime_id=showtime_id
    )
    if showtime is None:
        raise ShowtimeNotFoundError(showtime_id)

    # Visibility can be configured before a status is set; the stored mode is
    # applied to the effective cache once the user marks going/interested.
    _apply_showtime_visibility_mode_for_owner(
        session=session,
        showtime_id=showtime_id,
        owner_id=actor_id,
        mode=mode,
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
    yield_to_conflicting_showtime: bool = False,
) -> Showtime | None:
    """
    Insert or update a showtime and return the resulting database row.
    Uses the same +/-1h time-shift heuristic as insert_showtime_if_not_exists.
    If the only close match differs by movie_id (for example after a TMDB cache
    correction), reassign that existing showtime to the new movie_id.

    Returns None (creating nothing) if this exact showtime was previously
    deleted by an admin from the reports page — see DeletedShowtime.

    ``yield_to_conflicting_showtime`` is for the Cineville path: rather than
    adding a second row for a screening a cinema scraper already listed under a
    near-identical title, return that row so the Cineville presence attaches to
    it. Without this the duplicate is created every run and deleted again by
    ``_delete_cineville_title_conflicts``, which churned the same handful of
    showtimes through the recap's deletion list on every single scrape.
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
    if existing_showtime is None and showtimes_crud.is_showtime_tombstoned(
        session=session,
        movie_id=showtime_create.movie_id,
        cinema_id=showtime_create.cinema_id,
        datetime=showtime_create.datetime,
    ):
        return None

    if existing_showtime is None and yield_to_conflicting_showtime:
        conflicting_showtime = _find_conflicting_cinema_scraper_showtime(
            session=session,
            showtime_create=showtime_create,
        )
        if conflicting_showtime is not None:
            return conflicting_showtime

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
    current_user_id: ViewerId,
    limit: int,
    offset: int,
    filters: Filters,
) -> list[ShowtimePublic]:
    viewer_context.apply_viewer_defaults(
        session=session, viewer_id=current_user_id, filters=filters
    )

    letterboxd_username = None
    if filters.watchlist_only or filters.hide_watched:
        letterboxd_username = viewer_context.letterboxd_username_for(
            session=session,
            viewer_id=current_user_id,
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
        showtime_converters.to_public(
            showtime=showtime, session=session, user_id=current_user_id
        )
        for showtime in showtimes
    ]


def count_main_page_showtimes(
    *,
    session: Session,
    current_user_id: ViewerId,
    filters: Filters,
) -> int:
    viewer_context.apply_viewer_defaults(
        session=session, viewer_id=current_user_id, filters=filters
    )

    letterboxd_username = None
    if filters.watchlist_only or filters.hide_watched:
        letterboxd_username = viewer_context.letterboxd_username_for(
            session=session,
            viewer_id=current_user_id,
        )
    return showtimes_crud.count_main_page_showtimes(
        session=session,
        user_id=current_user_id,
        filters=filters,
        letterboxd_username=letterboxd_username,
    )
