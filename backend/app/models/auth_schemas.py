from pydantic import EmailStr
from sqlmodel import Field, SQLModel


class UserUpdateMe(SQLModel):
    display_name: str | None = Field(default=None, max_length=255)
    email: EmailStr | None = Field(default=None, max_length=255)
    letterboxd_username: str | None = Field(default=None, max_length=255)


class UpdatePassword(SQLModel):
    current_password: str = Field(min_length=1, max_length=255)
    new_password: str = Field(min_length=1, max_length=255)


# Generic message
class Message(SQLModel):
    message: str


# JSON payload containing access token
class Token(SQLModel):
    access_token: str
    token_type: str = Field(
        default="bearer", description="Type of the token, usually 'bearer'"
    )


# Contents of JWT token
class TokenPayload(SQLModel):
    sub: str | None = Field(
        default=None, description="Subject of the token, usually the user ID"
    )


class NewPassword(SQLModel):
    token: str
    new_password: str = Field(min_length=1, max_length=255)
