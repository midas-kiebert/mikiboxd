import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Optional

from pydantic import EmailStr
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Column, Field, Relationship, SQLModel

from app.core.enums import NotificationChannel
from app.utils import now_amsterdam_naive

if TYPE_CHECKING:
    from app.models.letterboxd import Letterboxd


# Shared properties — private base class, not part of the public API
class _UserBase(SQLModel):
    email: EmailStr = Field(unique=True, index=True, max_length=255)
    is_active: bool = Field(default=True)
    is_superuser: bool = Field(default=False)
    # Access to features whose cost is per-user rather than per-request — right
    # now only the sold-out watch, which polls one ticket shop hard on one
    # person's behalf. There is no paid tier and nothing about this reaches the
    # client as a tier: `UserMe` carries the one capability it unlocks
    # (`can_watch_sold_out`) and never the flag itself, so the app has no notion
    # of a Pro user to advertise, gate a screen behind, or get out of step with.
    # Who has it is decided in `core/db.py`, per environment.
    is_pro: bool = Field(default=False)
    incognito_mode: bool = Field(default=False)
    # Opt-in: also surface, on a showtime, friends of your friends who are
    # GOING/INTERESTED — but only reachable through a mutual friend who is
    # themself GOING/INTERESTED, and only when that mutual friend can already
    # see the friend-of-friend's status (see
    # `crud.showtime.get_friends_of_friends_for_showtime`). Off by default:
    # this reaches beyond the user's own friend graph, so it must be asked for.
    show_friends_of_friends_interest: bool = Field(default=False)
    notify_on_friend_showtime_match: bool = Field(default=True)
    notify_on_friend_requests: bool = Field(default=True)
    notify_on_showtime_ping: bool = Field(default=True)
    notify_on_invite_response: bool = Field(default=True)
    notify_on_interest_reminder: bool = Field(default=True)
    # "A showtime you're interested in is nearly sold out." Defaults on: it is
    # only ever sent once per showtime, and only for one someone already said
    # they cared about.
    notify_on_seat_alert: bool = Field(default=True)
    # "A showtime you're interested in has sold out." Its own preference rather
    # than a second use of the one above: the two say different things and are
    # wanted by different people — one hurries you along while you can still
    # act, the other tells you not to bother.
    notify_on_sold_out: bool = Field(default=True)
    # A friend nudging you about a showtime you're already GOING/INTERESTED on,
    # or invited to and haven't dismissed — distinct from `notify_on_showtime_ping`
    # (the invite itself). This preference is deliberately dual-purpose: it also
    # gates whether the mobile app offers *you* the "send reminder" button for
    # your own friends, so turning reminders off opts out of the feature in both
    # directions rather than just muting incoming ones.
    notify_on_showtime_reminder: bool = Field(default=True)
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
    notify_channel_seat_alert: NotificationChannel = Field(
        default=NotificationChannel.PUSH
    )
    notify_channel_sold_out: NotificationChannel = Field(
        default=NotificationChannel.PUSH
    )
    notify_channel_showtime_reminder: NotificationChannel = Field(
        default=NotificationChannel.PUSH
    )
    display_name: str | None = Field(default=None, max_length=255)
    letterboxd_username: str | None = Field(
        default=None,
        max_length=255,
        sa_column_kwargs={"index": True},
        foreign_key="letterboxd.letterboxd_username",
    )
    # Master switch. Which lists/cinemas/frequency to follow is configured per
    # `WatchlistDigestSource` row rather than here — a user may have several.
    notify_watchlist_digest_enabled: bool = Field(default=False)


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
    show_friends_of_friends_interest: bool | None = Field(default=None)
    notify_on_friend_showtime_match: bool | None = Field(default=None)
    notify_on_friend_requests: bool | None = Field(default=None)
    notify_on_showtime_ping: bool | None = Field(default=None)
    notify_on_invite_response: bool | None = Field(default=None)
    notify_on_interest_reminder: bool | None = Field(default=None)
    notify_on_seat_alert: bool | None = Field(default=None)
    notify_on_sold_out: bool | None = Field(default=None)
    notify_on_showtime_reminder: bool | None = Field(default=None)
    notify_channel_friend_showtime_match: NotificationChannel | None = Field(
        default=None
    )
    notify_channel_friend_requests: NotificationChannel | None = Field(default=None)
    notify_channel_showtime_ping: NotificationChannel | None = Field(default=None)
    notify_channel_invite_response: NotificationChannel | None = Field(default=None)
    notify_channel_interest_reminder: NotificationChannel | None = Field(default=None)
    notify_channel_seat_alert: NotificationChannel | None = Field(default=None)
    notify_channel_sold_out: NotificationChannel | None = Field(default=None)
    notify_channel_showtime_reminder: NotificationChannel | None = Field(default=None)
    notify_watchlist_digest_enabled: bool | None = Field(default=None)
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
    # Apple's refresh token for this account, kept for exactly one purpose:
    # revoking the user's Sign in with Apple tokens when they delete their
    # account, which Apple requires (see core/apple_auth.py). Never used to act
    # on the user's behalf, and never leaves the backend. None for accounts that
    # signed in before this shipped, or when Apple's code exchange did not
    # produce one — deletion then proceeds without revoking.
    apple_refresh_token: str | None = Field(default=None)
    # Bookkeeping for the switch-to-push-until-reverified behaviour on email
    # change (see me_service.update_me): which notify_channel_* fields were set
    # to EMAIL, and whether the digest was on, at the moment the address became
    # unverified. Restored verbatim by verify_email once the new address is
    # confirmed. Deliberately not on `_UserBase` — internal, never user-settable.
    unverified_email_saved_channels: list[str] | None = Field(
        default=None, sa_column=Column(JSONB, nullable=True)
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
