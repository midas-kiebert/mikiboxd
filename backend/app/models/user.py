import uuid
from typing import TYPE_CHECKING, Optional

from pydantic import EmailStr
from sqlmodel import Field, Relationship, SQLModel

if TYPE_CHECKING:
    from app.models.letterboxd import Letterboxd

__all__ = [
    "UserBase",
    "UserCreate",
    "UserUpdate",
    "UserRegister",
    "User",
]


# Shared properties
class UserBase(SQLModel):
    email: EmailStr = Field(unique=True, index=True, max_length=255)
    is_active: bool = Field(default=True)
    is_superuser: bool = Field(default=False)
    notify_on_friend_showtime_match: bool = Field(default=True)
    notify_on_friend_requests: bool = Field(default=True)
    notify_on_showtime_ping: bool = Field(default=True)
    notify_on_interest_reminder: bool = Field(default=True)
    display_name: str | None = Field(default=None, max_length=255)
    letterboxd_username: str | None = Field(
        default=None,
        max_length=255,
        sa_column_kwargs={"index": True},
        foreign_key="letterboxd.letterboxd_username",
    )


# Properties to receive via API on creation
class UserCreate(UserBase):
    password: str = Field(min_length=1, max_length=255)


class UserRegister(SQLModel):
    email: EmailStr = Field(max_length=255)
    password: str = Field(min_length=1, max_length=255)
    display_name: str | None = Field(default=None, max_length=255)


# Properties to receive via API on update, all are optional
class UserUpdate(SQLModel):
    display_name: str | None = Field(default=None, max_length=255)
    email: EmailStr | None = Field(default=None, max_length=255)
    letterboxd_username: str | None = Field(default=None, max_length=255)
    notify_on_friend_showtime_match: bool | None = Field(default=None)
    notify_on_friend_requests: bool | None = Field(default=None)
    notify_on_showtime_ping: bool | None = Field(default=None)
    notify_on_interest_reminder: bool | None = Field(default=None)
    password: str | None = Field(default=None, min_length=1, max_length=255)


# Database model, database table inferred from class name
class User(UserBase, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    hashed_password: str
    letterboxd: Optional["Letterboxd"] = Relationship(
        sa_relationship_kwargs={"lazy": "joined"},
    )
