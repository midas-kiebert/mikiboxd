from datetime import datetime
from uuid import UUID

from sqlmodel import Session

from app.converters import showtime as showtime_converters
from app.core.config import settings
from app.crud import friendship as friendship_crud
from app.crud import user as user_crud
from app.crud import watched as watched_crud
from app.crud import watchlist as watchlist_crud
from app.inputs.movie import Filters
from app.models.user import User, is_report_banned
from app.schemas.user import (
    UserMe,
    UserPublic,
    UserWithFriendStatus,
    UserWithShowtimesPublic,
)
from app.services.letterboxd_sync import SYNC_COOLDOWN, is_within_cooldown
from app.utils import now_amsterdam_naive


def _sync_cooldown_ends_at(
    *,
    last_sync: datetime | None,
    last_attempt: datetime | None,
) -> datetime | None:
    if not is_within_cooldown(last_sync=last_sync, last_attempt=last_attempt):
        return None
    return max(stamp for stamp in (last_sync, last_attempt) if stamp is not None) + (
        SYNC_COOLDOWN
    )


def _sync_failed(*, last_sync: datetime | None, last_attempt: datetime | None) -> bool:
    """Whether the most recent sync attempt did not end in success.

    A sync stamps `last_attempt` before scraping and only advances `last_sync`
    on success, so an attempt strictly after the last success means it failed.
    """
    if last_attempt is None:
        return False
    return last_sync is None or last_attempt > last_sync


def to_public(
    user: User,
    *,
    seat_row: str | None = None,
    seat_number: str | None = None,
) -> UserPublic:
    User.model_validate(user)
    return UserPublic(
        id=user.id,
        is_active=user.is_active,
        display_name=user.display_name,
        seat_row=seat_row,
        seat_number=seat_number,
    )


def to_me(user: User, *, session: Session) -> UserMe:
    User.model_validate(user)

    watchlist_last_synced = (
        user.letterboxd.last_watchlist_sync if user.letterboxd else None
    )
    watched_last_synced = user.letterboxd.last_watched_sync if user.letterboxd else None
    watchlist_last_attempt = (
        user.letterboxd.last_watchlist_sync_attempt if user.letterboxd else None
    )
    watched_last_attempt = (
        user.letterboxd.last_watched_sync_attempt if user.letterboxd else None
    )

    watchlist_count = 0
    watched_count = 0
    if user.letterboxd_username:
        watchlist_count = watchlist_crud.count_watchlist_selections(
            session=session, letterboxd_username=user.letterboxd_username
        )
        watched_count = watched_crud.count_watched_selections(
            session=session, letterboxd_username=user.letterboxd_username
        )

    return UserMe(
        id=user.id,
        is_active=user.is_active,
        display_name=user.display_name,
        email=user.email,
        email_verified=user.email_verified,
        show_watchlist_digest_tip=(
            settings.WATCHLIST_DIGEST_TIP_ENABLED
            and user.email_verified
            and not user.watchlist_digest_ever_enabled
            # The digest itself does not require this — it can follow a public
            # Letterboxd list instead of the user's own watchlist. Offering it
            # only to users who have connected an account is a narrower first
            # audience while the feature is still being lived with, not a limit
            # of the feature. Widening it is a change here and nowhere else.
            and bool(user.letterboxd_username)
        ),
        is_superuser=user.is_superuser,
        incognito_mode=user.incognito_mode,
        notify_on_friend_showtime_match=user.notify_on_friend_showtime_match,
        notify_on_friend_requests=user.notify_on_friend_requests,
        notify_on_showtime_ping=user.notify_on_showtime_ping,
        notify_on_invite_response=user.notify_on_invite_response,
        notify_on_interest_reminder=user.notify_on_interest_reminder,
        notify_channel_friend_showtime_match=user.notify_channel_friend_showtime_match,
        notify_channel_friend_requests=user.notify_channel_friend_requests,
        notify_channel_showtime_ping=user.notify_channel_showtime_ping,
        notify_channel_invite_response=user.notify_channel_invite_response,
        notify_channel_interest_reminder=user.notify_channel_interest_reminder,
        letterboxd_username=user.letterboxd_username,
        watchlist_count=watchlist_count,
        watched_count=watched_count,
        watchlist_last_synced=watchlist_last_synced,
        watched_last_synced=watched_last_synced,
        watchlist_last_sync_attempt=watchlist_last_attempt,
        watched_last_sync_attempt=watched_last_attempt,
        watchlist_sync_failed=_sync_failed(
            last_sync=watchlist_last_synced, last_attempt=watchlist_last_attempt
        ),
        watched_sync_failed=_sync_failed(
            last_sync=watched_last_synced, last_attempt=watched_last_attempt
        ),
        watchlist_sync_cooldown_ends_at=_sync_cooldown_ends_at(
            last_sync=watchlist_last_synced, last_attempt=watchlist_last_attempt
        ),
        watched_sync_cooldown_ends_at=_sync_cooldown_ends_at(
            last_sync=watched_last_synced, last_attempt=watched_last_attempt
        ),
        notify_watchlist_digest_enabled=user.notify_watchlist_digest_enabled,
        notify_watchlist_digest_frequency=user.notify_watchlist_digest_frequency,
        notify_watchlist_digest_list_id=user.notify_watchlist_digest_list_id,
        notify_watchlist_digest_cinema_preset_id=(
            user.notify_watchlist_digest_cinema_preset_id
        ),
        can_report=not is_report_banned(user),
        has_password=user.hashed_password is not None,
    )


def to_with_friend_status(
    user: User,
    *,
    session: Session,
    current_user: UUID,
    sharing_friend_ids: set[UUID] | None = None,
) -> UserWithFriendStatus:
    """
    Converts a User object to a UserWithFriendStatus object, including friendship status
    and friend request status between the current user and the specified user.

    Parameters:
        user (User): The User object to convert.
        session (Session): The SQLAlchemy session for database operations.
        current_user (UUID): The ID of the current user.
        sharing_friend_ids (set[UUID] | None): The friends the current user
            shares their status with (i.e. not opted out), pre-loaded by the
            caller to avoid a per-user query. When None, it is loaded here.
    Returns:
        UserWithFriendStatus: The converted UserWithFriendStatus object with friendship details.
    Raises:
        ValidationError: If the user does not match the expected model.
    """
    User.model_validate(user)
    if sharing_friend_ids is None:
        sharing_friend_ids = friendship_crud.get_status_sharing_friend_ids(
            session=session,
            owner_id=current_user,
        )
    is_friend = friendship_crud.are_users_friends(
        session=session,
        user_id=current_user,
        friend_id=user.id,
    )
    sent_request = friendship_crud.has_sent_friend_request(
        session=session,
        sender_id=current_user,
        receiver_id=user.id,
    )
    received_request = friendship_crud.has_sent_friend_request(
        session=session,
        sender_id=user.id,
        receiver_id=current_user,
    )
    return UserWithFriendStatus(
        id=user.id,
        is_active=user.is_active,
        display_name=user.display_name,
        is_friend=is_friend,
        sent_request=sent_request,
        received_request=received_request,
        # Sharing by default: only opted-out friends are absent from the set.
        shares_status=(not is_friend) or (user.id in sharing_friend_ids),
    )


def to_with_showtimes_public(
    user: User,
    *,
    session: Session,
    limit: int,
    offset: int,
    filters: Filters,
) -> UserWithShowtimesPublic:
    """
    Converts a User object to a UserPublic object, including showtimes.

    Parameters:
        user (User): The User object to convert.
    Returns:
        UserPublic: The converted UserPublic object with showtimes.
    Raises:
        ValidationError: If the user does not match the expected model.
    """

    now = now_amsterdam_naive()
    filters.snapshot_time = now

    User.model_validate(user)
    showtimes = [
        showtime_converters.to_logged_in(
            showtime=showtime, session=session, user_id=user.id
        )
        for showtime in user_crud.get_selected_showtimes(
            session=session,
            user_id=user.id,
            viewer_id=user.id,
            limit=limit,
            offset=offset,
            filters=filters,
            letterboxd_username=user.letterboxd_username,
        )
    ]

    return UserWithShowtimesPublic(
        id=user.id,
        is_active=user.is_active,
        display_name=user.display_name,
        showtimes_going=showtimes,
    )
