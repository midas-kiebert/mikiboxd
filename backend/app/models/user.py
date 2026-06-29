import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Optional

from pydantic import EmailStr
from sqlalchemy import Enum as SAEnum
from sqlmodel import Column, Field, Relationship, SQLModel

from app.core.enums import DigestFrequency, NotificationChannel

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
    notify_watchlist_digest_enabled: bool = Field(default=True)
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


# Database model, database table inferred from class name
class User(_UserBase, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    hashed_password: str
    # Drives the digest lookback window and prevents double-sends; not user-facing.
    notify_watchlist_digest_last_sent_at: datetime | None = Field(default=None)
    letterboxd: Optional["Letterboxd"] = Relationship(
        sa_relationship_kwargs={"lazy": "joined"},
    )
