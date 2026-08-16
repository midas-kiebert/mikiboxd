from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID

from pydantic import EmailStr
from sqlmodel import SQLModel

from app.core.enums import DigestFrequency, NotificationChannel

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
    notify_on_friend_showtime_match: bool
    notify_on_friend_requests: bool
    notify_on_showtime_ping: bool
    notify_on_invite_response: bool
    notify_on_interest_reminder: bool
    notify_channel_friend_showtime_match: NotificationChannel
    notify_channel_friend_requests: NotificationChannel
    notify_channel_showtime_ping: NotificationChannel
    notify_channel_invite_response: NotificationChannel
    notify_channel_interest_reminder: NotificationChannel
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
    notify_watchlist_digest_enabled: bool
    notify_watchlist_digest_frequency: DigestFrequency
    notify_watchlist_digest_list_id: UUID | None
    notify_watchlist_digest_cinema_preset_id: UUID | None
    can_report: bool
    has_password: bool


class UserWithFriendStatus(UserPublic):
    is_friend: bool
    sent_request: bool
    received_request: bool
    # Whether the current user shares their status with this friend by default
    # (True unless they've opted out; opted-out friends only see status on invite).
    shares_status: bool = True


class UserWithShowtimesPublic(UserPublic):
    showtimes_going: list["ShowtimePublic"]
