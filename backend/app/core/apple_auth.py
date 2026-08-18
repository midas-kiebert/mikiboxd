"""Apple's OAuth token endpoints: code exchange and token revocation.

Separate from `core/security.py`, which only ever *verifies* provider tokens
Apple has already issued. This module talks to Apple as a client, which needs
credentials (`APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`) that
verification does not.

**Why this exists.** Apple requires that an app offering Sign in with Apple
revoke the user's tokens when they delete their account — it is called out
explicitly on the account-deletion page that App Store Review guideline
5.1.1(v) links to. Deleting the `user` row is not enough on its own: without a
revoke call the Apple ID keeps MiKiNO listed under "Sign in with Apple" in the
user's Apple account settings, and signing in again silently re-links to an
account that no longer exists.

**The two calls, and why both are needed.** Revocation takes a token, and the
native Sign in with Apple flow on the device never produces one — it yields an
identity token (a JWT we verify, not revocable) and a short-lived authorization
code. So the code is exchanged for a refresh token at sign-in time and stored,
and that refresh token is what deletion revokes. An account that signed in
before this shipped has no stored token; deletion then proceeds without
revoking, which is the same position it was already in.

**Everything here fails soft.** A user asking to delete their account must
always succeed, whatever Apple's endpoint happens to be doing, so callers log
and continue. Nothing in this module raises at its callers.
"""

import datetime as dt
import logging
import time
from typing import Any

import httpx
import jwt

from app.core.config import settings

logger = logging.getLogger(__name__)

_APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token"
_APPLE_REVOKE_URL = "https://appleid.apple.com/auth/revoke"
_APPLE_AUDIENCE = "https://appleid.apple.com"

# Apple caps the client-secret JWT at six months. Nothing keeps one around that
# long — it is minted per request — so this is only the `exp` Apple validates.
_CLIENT_SECRET_TTL = dt.timedelta(minutes=5)

_REQUEST_TIMEOUT_SECONDS = 10.0


class AppleAuthError(Exception):
    """Raised inside this module when Apple's endpoints cannot be used.

    Never escapes to a route: both public functions catch it and return None.
    """


def _private_key() -> str:
    """The .p8 contents, with escaped newlines from env vars restored.

    A PEM key pasted into an env var usually arrives with literal backslash-n
    rather than real newlines, which the JWT library rejects with an error that
    does not mention newlines at all.
    """
    key = settings.APPLE_PRIVATE_KEY or ""
    return key.replace("\\n", "\n").strip()


def apple_client_secret() -> str:
    """Mint the ES256 client-secret JWT Apple's token endpoints expect.

    Raises:
        AppleAuthError: If the Apple credentials are not configured, or the
            private key cannot be used to sign.
    """
    if not settings.apple_token_revocation_configured:
        raise AppleAuthError("Apple token credentials are not configured")
    issued_at = int(time.time())
    payload = {
        "iss": settings.APPLE_TEAM_ID,
        "iat": issued_at,
        "exp": issued_at + int(_CLIENT_SECRET_TTL.total_seconds()),
        "aud": _APPLE_AUDIENCE,
        "sub": settings.APPLE_CLIENT_ID,
    }
    try:
        return jwt.encode(
            payload,
            _private_key(),
            algorithm="ES256",
            headers={"kid": settings.APPLE_KEY_ID},
        )
    except Exception as e:
        raise AppleAuthError(f"Could not sign the Apple client secret: {e}") from e


def _post(url: str, data: dict[str, Any]) -> httpx.Response:
    with httpx.Client(timeout=_REQUEST_TIMEOUT_SECONDS) as client:
        return client.post(
            url,
            data=data,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )


def exchange_authorization_code(authorization_code: str) -> str | None:
    """Trade a native sign-in authorization code for a refresh token.

    Returns None — never raises — when the credentials are unconfigured or Apple
    refuses the exchange. A sign-in must not fail because the thing that would
    let us revoke tokens later is unavailable now.
    """
    if not settings.apple_token_revocation_configured:
        logger.info(
            "Apple token credentials are not configured; not storing a refresh "
            "token for this sign-in (account deletion will skip revocation)"
        )
        return None
    try:
        client_secret = apple_client_secret()
    except AppleAuthError:
        logger.exception("Could not build the Apple client secret")
        return None

    try:
        response = _post(
            _APPLE_TOKEN_URL,
            {
                "client_id": settings.APPLE_CLIENT_ID,
                "client_secret": client_secret,
                "code": authorization_code,
                "grant_type": "authorization_code",
            },
        )
    except httpx.HTTPError:
        logger.exception("Apple authorization-code exchange failed to send")
        return None

    if response.status_code >= 400:
        # Logged at info: an already-used or expired code is the ordinary case
        # (the client retried, or the user backgrounded the app mid-sign-in) and
        # costs nothing but the ability to revoke later.
        logger.info(
            "Apple rejected the authorization-code exchange: %s %s",
            response.status_code,
            response.text,
        )
        return None

    refresh_token = response.json().get("refresh_token")
    if not isinstance(refresh_token, str) or not refresh_token:
        logger.info("Apple's code exchange returned no refresh token")
        return None
    return refresh_token


def revoke_refresh_token(refresh_token: str) -> bool:
    """Revoke a stored Apple refresh token. True if Apple accepted it.

    Returns False — never raises — on any failure, so a deletion is never
    blocked by Apple being unreachable. Apple treats revoking an already-revoked
    token as a success, which makes a retry safe.
    """
    if not settings.apple_token_revocation_configured:
        logger.warning(
            "Apple token credentials are not configured; skipping token "
            "revocation on account deletion"
        )
        return False
    try:
        client_secret = apple_client_secret()
    except AppleAuthError:
        logger.exception("Could not build the Apple client secret")
        return False

    try:
        response = _post(
            _APPLE_REVOKE_URL,
            {
                "client_id": settings.APPLE_CLIENT_ID,
                "client_secret": client_secret,
                "token": refresh_token,
                "token_type_hint": "refresh_token",
            },
        )
    except httpx.HTTPError:
        logger.exception("Apple token revocation failed to send")
        return False

    if response.status_code >= 400:
        logger.error(
            "Apple refused the token revocation: %s %s",
            response.status_code,
            response.text,
        )
        return False
    return True
