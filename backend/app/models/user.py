import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from pydantic import EmailStr
from sqlmodel import Field, Relationship, SQLModel

if TYPE_CHECKING:
    from .item import Item  # Avoid circular import issues
    from .showtime import Showtime


# Shared properties
class UserBase(SQLModel):
    email: EmailStr = Field(unique=True, index=True, max_length=255)
    is_active: bool = Field(default=True, description="Indicates if the user is active")
    is_superuser: bool = Field(
        default=False, description="Indicates if the user has superuser privileges"
    )
    display_name: str | None = Field(default=None, max_length=255)
    letterboxd_username: str | None = Field(default=None, max_length=255)


# Properties to receive via API on creation
class UserCreate(UserBase):
    password: str = Field(min_length=1, max_length=255)


class UserRegister(SQLModel):
    email: EmailStr = Field(max_length=255)
    password: str = Field(min_length=1, max_length=255)
    display_name: str | None = Field(default=None, max_length=255)


# Properties to receive via API on update, all are optional
class UserUpdate(UserBase):
    email: EmailStr | None = Field(default=None, max_length=255)  # type: ignore
    password: str | None = Field(default=None, min_length=1, max_length=255)


# Database model, database table inferred from class name
class User(UserBase, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    hashed_password: str
    last_watchlist_sync: datetime | None = Field(
        default=None, description="Last time the watchlist was synced"
    )
    items: list["Item"] = Relationship(back_populates="owner", cascade_delete=True)


# Properties to return via API, id is always required
class UserPublic(UserBase):
    id: uuid.UUID
    last_watchlist_sync: datetime | None = Field(
        default=None, description="Last time the watchlist was synced"
    )


class UserWithFriendInfoPublic(UserPublic):
    is_friend: bool = Field(
        default=False, description="Indicates if the user is a friend"
    )
    sent_request: bool = Field(
        default=False,
        description="Indicates if the user has sent you a friendship request",
    )
    received_request: bool = Field(
        default=False,
        description="Indicates if the user has received a friendship request from you",
    )


class UserWithShowtimesPublic(UserPublic):
    showtimes_going: list["Showtime"] = Field(
        default_factory=list, description="List of showtimes the user is going to"
    )


class UsersPublic(SQLModel):
    data: list[UserPublic]
    count: int
