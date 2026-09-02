from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID

from pydantic import EmailStr
from sqlmodel import SQLModel

from app.core.enums import NotificationChannel, VisibilityMode

if TYPE_CHECKING:
    from .showtime import ShowtimePublic

__all__ = [
    "UserPublic",
    "UserMe",
    "UserWithFriendStatus",
    "UserWithShowtimesPublic",
]


class UserPublic(SQLModel):
    id: UUID
    is_active: bool
    display_name: str | None
    seat_row: str | None = None
    seat_number: str | None = None


class UserMe(UserPublic):
    email: EmailStr
    email_verified: bool
    # Whether the app should offer the watchlist digest to this user. Decided
    # here rather than by the client so both the switch and who it reaches can
    # be changed from the backend without waiting for a release: it combines the
    # global WATCHLIST_DIGEST_TIP_ENABLED switch with "this account can receive
    # email at all", "has never turned the digest on", and — for now, as a
    # narrower first audience rather than a real requirement — "has a Letterboxd
    # account connected".
    show_watchlist_digest_tip: bool
    is_superuser: bool
    incognito_mode: bool
    default_visibility_mode: VisibilityMode
    # Whether the account is going to / interested in anything at all. Those
    # showtimes follow `default_visibility_mode` unless individually overridden,
    # so changing it asks whether they should come along — a question the
    # settings screen skips entirely when this is False.
    has_selected_showtimes: bool
    notify_on_friend_showtime_match: bool
    notify_on_friend_requests: bool
    notify_on_showtime_ping: bool
    notify_on_invite_response: bool
    notify_on_interest_reminder: bool
    notify_on_seat_alert: bool
    notify_on_sold_out: bool
    notify_on_showtime_reminder: bool
    notify_channel_friend_showtime_match: NotificationChannel
    notify_channel_friend_requests: NotificationChannel
    notify_channel_showtime_ping: NotificationChannel
    notify_channel_invite_response: NotificationChannel
    notify_channel_interest_reminder: NotificationChannel
    notify_channel_seat_alert: NotificationChannel
    notify_channel_sold_out: NotificationChannel
    notify_channel_showtime_reminder: NotificationChannel
    letterboxd_username: str | None
    watchlist_count: int
    watched_count: int
    watchlist_last_synced: datetime | None = None
    watched_last_synced: datetime | None = None
    watchlist_last_sync_attempt: datetime | None = None
    watched_last_sync_attempt: datetime | None = None
    watchlist_sync_failed: bool = False
    watched_sync_failed: bool = False
    watchlist_sync_cooldown_ends_at: datetime | None = None
    watched_sync_cooldown_ends_at: datetime | None = None
    # Master switch; which lists/cinemas/frequency to follow lives in
    # `GET /me/watchlist-digest-sources` (a user may have several).
    notify_watchlist_digest_enabled: bool
    can_report: bool
    # Whether this account may ask to be told when a full showtime has seats
    # again. The capability, never the tier behind it: the app has no concept
    # of a Pro user, so it cannot label one, advertise one, or disagree with the
    # backend about who is one.
    can_watch_sold_out: bool
    has_password: bool


class UserWithFriendStatus(UserPublic):
    is_friend: bool
    sent_request: bool
    received_request: bool
    # Whether the current user shares their status with this friend by default
    # (True unless they've opted out; opted-out friends only see status on invite).
    shares_status: bool = True
    # Whether the *current user* has blocked this one, which is what the profile
    # screen needs to label its button Block or Unblock. Never the other
    # direction: being blocked by someone must not be visible to the person
    # blocked, or the block itself becomes a message. Defaults False because the
    # search path excludes blocked users outright and never needs to compute it.
    is_blocked: bool = False


class UserWithShowtimesPublic(UserPublic):
    showtimes_going: list["ShowtimePublic"]
