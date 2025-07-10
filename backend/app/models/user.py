import uuid

from pydantic import EmailStr
from sqlmodel import Field, Relationship, SQLModel, and_
from .friendship import Friendship, FriendRequest

from typing import TYPE_CHECKING, List
from .showtime_selection import ShowtimeSelection
if TYPE_CHECKING:
    from .item import Item  # Avoid circular import issues
    from .showtime import Showtime


# Shared properties
class UserBase(SQLModel):
    email: EmailStr = Field(unique=True, index=True, max_length=255)
    is_active: bool = True
    is_superuser: bool = False
    display_name: str | None = Field(default=None, max_length=255)


# Properties to receive via API on creation
class UserCreate(UserBase):
    password: str = Field(min_length=8, max_length=40)


class UserRegister(SQLModel):
    email: EmailStr = Field(max_length=255)
    password: str = Field(min_length=8, max_length=40)
    display_name: str | None = Field(default=None, max_length=255)


# Properties to receive via API on update, all are optional
class UserUpdate(UserBase):
    email: EmailStr | None = Field(default=None, max_length=255)  # type: ignore
    password: str | None = Field(default=None, min_length=8, max_length=40)


# Database model, database table inferred from class name
class User(UserBase, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    hashed_password: str
    items: list["Item"] = Relationship(back_populates="owner", cascade_delete=True)


# Properties to return via API, id is always required
class UserPublic(UserBase):
    id: uuid.UUID


class UserWithShowtimesPublic(UserPublic):
    showtimes_going: List["Showtime"] = Field(default_factory=list, description="List of showtimes the user is going to")

class UsersPublic(SQLModel):
    data: list[UserPublic]
    count: int
