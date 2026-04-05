"""Password hashing and JWT token helpers.

This module is intentionally thin — it contains only the low-level cryptographic
primitives used by the authentication layer. Business logic (e.g. "is this user
allowed to do X?") lives in services, not here.

JWT (JSON Web Token) overview:
    A JWT is a signed, URL-safe string with three base64-encoded parts:
      header.payload.signature
    The payload contains claims like the user ID and expiry time. Because the
    token is signed with SECRET_KEY, the server can verify it hasn't been tampered
    with — without hitting the database on every request.

Password hashing overview:
    Passwords are never stored in plain text. `get_password_hash` runs the raw
    password through bcrypt (a slow, salted hash) before storing it. On login,
    `verify_password` runs the same process on the submitted password and
    compares the result to the stored hash.
"""

from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from passlib.context import CryptContext

from app.core.config import settings

# bcrypt is the recommended algorithm — it is deliberately slow, making
# brute-force attacks expensive. "deprecated=auto" will warn if older schemes
# are detected in stored hashes (useful during algorithm migrations).
_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

ALGORITHM = "HS256"  # HMAC-SHA256 — standard for symmetric JWT signing


def create_access_token(subject: str | Any, expires_delta: timedelta) -> str:
    """Create a signed JWT access token for the given subject (typically a user ID).

    Args:
        subject: The value to store in the token's `sub` claim. This is used to
                 identify the user when the token is later decoded.
        expires_delta: How long until the token expires. After this time the
                       token will be rejected by `get_current_user`.

    Returns:
        A signed JWT string that can be sent to the client and included in
        future requests via the Authorization: Bearer header.
    """
    expire = datetime.now(timezone.utc) + expires_delta
    to_encode = {"exp": expire, "sub": str(subject)}
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=ALGORITHM)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Check whether a plain-text password matches a stored bcrypt hash.

    Args:
        plain_password: The raw password submitted by the user at login.
        hashed_password: The bcrypt hash stored in the database.

    Returns:
        True if the password matches, False otherwise.
    """
    return _pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    """Hash a plain-text password using bcrypt.

    Args:
        password: The raw password to hash (e.g. submitted at registration).

    Returns:
        A bcrypt hash string safe to store in the database.
    """
    return _pwd_context.hash(password)


def generate_password_reset_token(email: str) -> str:
    """Generate a short-lived JWT for use in password reset emails.

    The token encodes the user's email as the `sub` claim and expires after
    EMAIL_RESET_TOKEN_EXPIRE_HOURS hours.
    """
    delta = timedelta(hours=settings.EMAIL_RESET_TOKEN_EXPIRE_HOURS)
    now = datetime.now(timezone.utc)
    exp = (now + delta).timestamp()
    return jwt.encode(
        {"exp": exp, "nbf": now, "sub": email},
        settings.SECRET_KEY,
        algorithm=ALGORITHM,
    )


def verify_password_reset_token(token: str) -> str | None:
    """Decode and validate a password reset token.

    Returns:
        The email address encoded in the token, or None if the token is
        invalid or expired.
    """
    try:
        decoded = jwt.decode(
            token, settings.SECRET_KEY, algorithms=[ALGORITHM]
        )
        return str(decoded["sub"])
    except jwt.exceptions.InvalidTokenError:
        return None
