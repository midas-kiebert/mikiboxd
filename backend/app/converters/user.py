from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlmodel import Session

from app.converters import showtime as showtime_converters
from app.core.config import settings
from app.crud import friendship as friendship_crud
from app.crud import push_token as push_token_crud
from app.crud import showtime_visibility as showtime_visibility_crud
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
from app.scraping.letterboxd.watchlist import is_placeholder_avatar_url
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


def avatar_url(user: User) -> str | None:
    """The Letterboxd picture, shown only once the user has opted in
    (`use_letterboxd_avatar`). `user.letterboxd` is `lazy="joined"` (see
    `models.user.User`), so this never costs an extra query beyond however
    `user` itself was loaded."""
    if not user.use_letterboxd_avatar:
        return None
    return _letterboxd_picture(user)


def _letterboxd_picture(user: User) -> str | None:
    """The account's own Letterboxd picture, or `None` for Letterboxd's
    generic placeholder — our coloured initial reads better than that. Checked
    here as well as at scrape time because rows synced before the scraper
    filtered it still hold it, and a sync that finds no picture leaves the
    stored one alone."""
    if user.letterboxd is None or user.letterboxd.avatar_url is None:
        return None
    url = user.letterboxd.avatar_url
    return None if is_placeholder_avatar_url(url) else url


def to_public(
    user: User,
    *,
    seat_row: str | None = None,
    seat_number: str | None = None,
) -> UserPublic:
    return UserPublic(
        id=user.id,
        is_active=user.is_active,
        display_name=user.display_name,
        avatar_url=avatar_url(user),
        seat_row=seat_row,
        seat_number=seat_number,
    )


def to_me(user: User, *, session: Session) -> UserMe:
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
        avatar_url=avatar_url(user),
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
        default_visibility_mode=user.default_visibility_mode,
        has_selected_showtimes=showtime_visibility_crud.has_selected_showtimes(
            session=session, owner_id=user.id
        ),
        notify_on_friend_showtime_match=user.notify_on_friend_showtime_match,
        notify_on_friend_requests=user.notify_on_friend_requests,
        notify_on_showtime_ping=user.notify_on_showtime_ping,
        notify_on_invite_response=user.notify_on_invite_response,
        notify_on_interest_reminder=user.notify_on_interest_reminder,
        notify_on_seat_alert=user.notify_on_seat_alert,
        notify_on_sold_out=user.notify_on_sold_out,
        notify_on_tickets_available=user.notify_on_tickets_available,
        notify_on_showtime_reminder=user.notify_on_showtime_reminder,
        notify_channel_friend_showtime_match=user.notify_channel_friend_showtime_match,
        notify_channel_friend_requests=user.notify_channel_friend_requests,
        notify_channel_showtime_ping=user.notify_channel_showtime_ping,
        notify_channel_invite_response=user.notify_channel_invite_response,
        notify_channel_interest_reminder=user.notify_channel_interest_reminder,
        notify_channel_seat_alert=user.notify_channel_seat_alert,
        notify_channel_sold_out=user.notify_channel_sold_out,
        notify_channel_tickets_available=user.notify_channel_tickets_available,
        notify_channel_showtime_reminder=user.notify_channel_showtime_reminder,
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
        use_letterboxd_avatar=user.use_letterboxd_avatar,
        letterboxd_avatar_url=_letterboxd_picture(user),
        letterboxd_account_not_found=(
            user.letterboxd.account_not_found if user.letterboxd else False
        ),
        can_report=not is_report_banned(user),
        can_watch_sold_out=user.is_pro,
        has_password=user.hashed_password is not None,
        has_push_token=push_token_crud.user_has_push_token(
            session=session, user_id=user.id
        ),
        app_notifications_prompted=user.app_notifications_prompted_at is not None,
    )


@dataclass(frozen=True)
class FriendStatusIndex:
    """Where the viewer stands with everyone, resolved once.

    `to_with_friend_status` otherwise asks three questions per person — are we
    friends, did I send them a request, did they send me one — and each is a
    query. Annotating a page of people that way costs three queries per person;
    this costs four for any number of them. Build it with
    `load_friend_status_index`.
    """

    friend_ids: set[UUID]
    sent_request_ids: set[UUID]
    received_request_ids: set[UUID]
    sharing_friend_ids: set[UUID]


def load_friend_status_index(*, session: Session, user_id: UUID) -> FriendStatusIndex:
    """Read `FriendStatusIndex` for one viewer."""
    return FriendStatusIndex(
        friend_ids=friendship_crud.get_friend_ids(session=session, user_id=user_id),
        sent_request_ids=friendship_crud.get_sent_friend_request_receiver_ids(
            session=session, sender_id=user_id
        ),
        received_request_ids=friendship_crud.get_received_friend_request_sender_ids(
            session=session, receiver_id=user_id
        ),
        sharing_friend_ids=friendship_crud.get_status_sharing_friend_ids(
            session=session, owner_id=user_id
        ),
    )


def to_with_friend_status(
    user: User,
    *,
    session: Session,
    current_user: UUID,
    sharing_friend_ids: set[UUID] | None = None,
    is_blocked: bool = False,
    index: FriendStatusIndex | None = None,
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
        is_blocked (bool): Whether the current user has blocked this user. Passed
            in rather than looked up, since the callers that need it know it and
            the search path deliberately never asks.
        index (FriendStatusIndex | None): The viewer's friendships and pending
            requests, pre-loaded by a caller converting more than one user.
            When given, every lookup below is answered from it and this costs
            no queries at all.
    Returns:
        UserWithFriendStatus: The converted UserWithFriendStatus object with friendship details.
    """
    if index is not None:
        sharing_friend_ids = index.sharing_friend_ids
        is_friend = user.id in index.friend_ids
        sent_request = user.id in index.sent_request_ids
        received_request = user.id in index.received_request_ids
    else:
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
        avatar_url=avatar_url(user),
        is_friend=is_friend,
        sent_request=sent_request,
        received_request=received_request,
        # Sharing by default: only opted-out friends are absent from the set.
        shares_status=(not is_friend) or (user.id in sharing_friend_ids),
        is_blocked=is_blocked,
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
    """

    now = now_amsterdam_naive()
    filters.snapshot_time = now

    selected_showtimes = user_crud.get_selected_showtimes(
        session=session,
        user_id=user.id,
        viewer_id=user.id,
        limit=limit,
        offset=offset,
        filters=filters,
        letterboxd_username=user.letterboxd_username,
    )
    visibility_modes = showtime_converters.viewer_visibility_modes(
        session=session, showtimes=selected_showtimes, user_id=user.id
    )
    showtimes = [
        showtime_converters.to_public(
            showtime=showtime,
            session=session,
            user_id=user.id,
            visibility_modes=visibility_modes,
        )
        for showtime in selected_showtimes
    ]

    return UserWithShowtimesPublic(
        id=user.id,
        is_active=user.is_active,
        display_name=user.display_name,
        avatar_url=avatar_url(user),
        showtimes_going=showtimes,
    )
