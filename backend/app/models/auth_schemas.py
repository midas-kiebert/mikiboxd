"""Auth-related request/response schemas shared across login and me routes.

These are plain Pydantic models (no table=True) and live in models/ because they
are simple data containers with no route-layer or service-layer concerns.
"""

from pydantic import EmailStr
from sqlmodel import Field, SQLModel

from app.core.enums import SocialProvider


class UserUpdateMe(SQLModel):
    display_name: str | None = Field(default=None, max_length=255)
    email: EmailStr | None = Field(default=None, max_length=255)
    letterboxd_username: str | None = Field(default=None, max_length=255)


class UpdatePassword(SQLModel):
    # None for accounts with no password yet (social-only sign-in) adding their first one.
    current_password: str | None = Field(default=None, min_length=1, max_length=255)
    new_password: str = Field(min_length=1, max_length=255)


# Generic message
class Message(SQLModel):
    message: str


# JSON payload containing the access token and its refresh token
class Token(SQLModel):
    access_token: str
    refresh_token: str
    token_type: str = Field(
        default="bearer", description="Type of the token, usually 'bearer'"
    )


# Request body for exchanging a refresh token for a fresh access token
class RefreshTokenRequest(SQLModel):
    refresh_token: str


# Contents of JWT token
class TokenPayload(SQLModel):
    sub: str | None = Field(
        default=None, description="Subject of the token, usually the user ID"
    )
    type: str | None = Field(
        default=None, description="Token type: 'access' or 'refresh'"
    )


class NewPassword(SQLModel):
    token: str
    new_password: str = Field(min_length=1, max_length=255)


# Request body for POST /login/social-token
class SocialLoginRequest(SQLModel):
    provider: SocialProvider
    token: str


# Response body for POST /login/social-token
class SocialLoginResponse(Token):
    # True when the account has no display name that satisfies the app's
    # username rules yet — the client should send the user to pick one
    # before letting them into the app.
    needs_username: bool = False
    # True when this sign-in linked the provider to an account whose email had
    # never been confirmed, and so discarded that account's password (see
    # `get_or_create_social_user`). The client shows a one-time notice: the user
    # would otherwise only find out the next time they tried that password.
    password_removed: bool = False
