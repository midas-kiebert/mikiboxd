import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Optional

from pydantic import EmailStr
from sqlalchemy import JSON
from sqlalchemy import Enum as SAEnum
from sqlmodel import Column, Field, Relationship, SQLModel

from app.core.enums import DigestFrequency, NotificationChannel
from app.utils import now_amsterdam_naive

if TYPE_CHECKING:
    from app.models.letterboxd import Letterboxd


# Shared properties — private base class, not part of the public API
class _UserBase(SQLModel):
    email: EmailStr = Field(unique=True, index=True, max_length=255)
    is_active: bool = Field(default=True)
    is_superuser: bool = Field(default=False)
    incognito_mode: bool = Field(default=False)
    notify_on_friend_showtime_match: bool = Field(default=True)
    notify_on_friend_requests: bool = Field(default=True)
    notify_on_showtime_ping: bool = Field(default=True)
    notify_on_invite_response: bool = Field(default=True)
    notify_on_interest_reminder: bool = Field(default=True)
    notify_channel_friend_showtime_match: NotificationChannel = Field(
        default=NotificationChannel.PUSH
    )
    notify_channel_friend_requests: NotificationChannel = Field(
        default=NotificationChannel.PUSH
    )
    notify_channel_showtime_ping: NotificationChannel = Field(
        default=NotificationChannel.PUSH
    )
    notify_channel_invite_response: NotificationChannel = Field(
        default=NotificationChannel.PUSH
    )
    notify_channel_interest_reminder: NotificationChannel = Field(
        default=NotificationChannel.PUSH
    )
    display_name: str | None = Field(default=None, max_length=255)
    letterboxd_username: str | None = Field(
        default=None,
        max_length=255,
        sa_column_kwargs={"index": True},
        foreign_key="letterboxd.letterboxd_username",
    )
    notify_watchlist_digest_enabled: bool = Field(default=False)
    notify_watchlist_digest_frequency: DigestFrequency = Field(
        sa_column=Column(
            SAEnum(
                DigestFrequency,
                native_enum=False,
                length=40,
                values_callable=lambda enum: [m.value for m in enum],
            ),
            nullable=False,
        ),
        default=DigestFrequency.WEEKLY_OR_URGENT,
    )
    notify_watchlist_digest_list_id: uuid.UUID | None = Field(
        default=None,
        foreign_key="letterboxdlist.id",
    )
    # Restricts the digest to movies with a future showtime at one of this
    # cinema preset's cinemas. None falls back to the user's favorite preset;
    # if neither resolves, the digest is not cinema-filtered.
    notify_watchlist_digest_cinema_preset_id: uuid.UUID | None = Field(
        default=None,
        foreign_key="cinemapreset.id",
    )


# Properties to receive via API on creation (admin/superuser use — exposes all fields)
class UserCreate(_UserBase):
    password: str = Field(min_length=1, max_length=255)


# Properties to receive via API on self-registration (email + password + display_name only)
class UserRegister(SQLModel):
    email: EmailStr = Field(max_length=255)
    password: str = Field(min_length=1, max_length=255)
    display_name: str | None = Field(default=None, max_length=255)


# Properties to receive via API on update, all are optional
class UserUpdate(SQLModel):
    display_name: str | None = Field(default=None, max_length=255)
    email: EmailStr | None = Field(default=None, max_length=255)
    letterboxd_username: str | None = Field(default=None, max_length=255)
    incognito_mode: bool | None = Field(default=None)
    notify_on_friend_showtime_match: bool | None = Field(default=None)
    notify_on_friend_requests: bool | None = Field(default=None)
    notify_on_showtime_ping: bool | None = Field(default=None)
    notify_on_invite_response: bool | None = Field(default=None)
    notify_on_interest_reminder: bool | None = Field(default=None)
    notify_channel_friend_showtime_match: NotificationChannel | None = Field(
        default=None
    )
    notify_channel_friend_requests: NotificationChannel | None = Field(default=None)
    notify_channel_showtime_ping: NotificationChannel | None = Field(default=None)
    notify_channel_invite_response: NotificationChannel | None = Field(default=None)
    notify_channel_interest_reminder: NotificationChannel | None = Field(default=None)
    notify_watchlist_digest_enabled: bool | None = Field(default=None)
    notify_watchlist_digest_frequency: DigestFrequency | None = Field(default=None)
    notify_watchlist_digest_list_id: uuid.UUID | None = Field(default=None)
    notify_watchlist_digest_cinema_preset_id: uuid.UUID | None = Field(default=None)
    password: str | None = Field(default=None, min_length=1, max_length=255)
    # Required to confirm a username or email change (see me_service.update_me);
    # ignored otherwise. Never reaches the database — popped from the update
    # dict before crud.update_user's sqlmodel_update, same as `password` is.
    current_password: str | None = Field(default=None, min_length=1, max_length=255)


# Database model, database table inferred from class name
class User(_UserBase, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    # None for social-only accounts (signed up via Apple/Google, never set a password).
    hashed_password: str | None = None
    # Sticky: set the first time the watchlist digest is switched on and never
    # cleared. "Has never been turned on" is what makes someone a candidate for
    # the tip that points the feature out, and turning it on and then off again
    # is a decision, not a reason to be told about it a second time.
    watchlist_digest_ever_enabled: bool = Field(default=False)
    # Whether this address has been proven to belong to whoever holds the
    # account: by clicking the link mailed at registration, or by a provider
    # asserting `email_verified` in a signed token. Deliberately *not* on
    # `_UserBase` — it must not be settable through UserCreate/UserUpdate, or an
    # account could simply declare itself verified via PATCH /me.
    email_verified: bool = Field(default=False)
    # Provider subject identifiers for social sign-in. Nullable/unique: a user has
    # at most one linked identity per provider, and most users will have zero or one.
    apple_sub: str | None = Field(default=None, unique=True, index=True)
    google_sub: str | None = Field(default=None, unique=True, index=True)
    # Drives the digest lookback window and prevents double-sends; not user-facing.
    notify_watchlist_digest_last_sent_at: datetime | None = Field(default=None)
    # Bookkeeping for the switch-to-push-until-reverified behaviour on email
    # change (see me_service.update_me): which notify_channel_* fields were set
    # to EMAIL, and whether the digest was on, at the moment the address became
    # unverified. Restored verbatim by verify_email once the new address is
    # confirmed. Deliberately not on `_UserBase` — internal, never user-settable.
    unverified_email_saved_channels: list[str] | None = Field(
        default=None, sa_column=Column(JSON, nullable=True)
    )
    unverified_email_saved_digest_enabled: bool = Field(default=False)
    # Moderation: blocks POST /showtimes/{id}/report. None expiry + banned=True
    # means indefinite; a past expiry is treated as no-longer-banned.
    report_banned: bool = Field(default=False)
    report_ban_expires_at: datetime | None = Field(default=None)
    letterboxd: Optional["Letterboxd"] = Relationship(
        sa_relationship_kwargs={"lazy": "joined"},
    )


def is_report_banned(user: User) -> bool:
    """Whether `user` is currently blocked from reporting showtimes."""
    if not user.report_banned:
        return False
    if user.report_ban_expires_at is None:
        return True
    return user.report_ban_expires_at > now_amsterdam_naive()
