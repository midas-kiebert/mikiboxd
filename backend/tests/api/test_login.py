"""Tests for the login + refresh-token auth flow."""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.core.enums import SocialProvider
from app.core.security import InvalidSocialToken, SocialClaims
from app.crud import user as user_crud
from app.models.user import User, UserCreate
from tests.utils.utils import random_email, random_lower_string


def _login(client: TestClient) -> dict[str, str]:
    r = client.post(
        f"{settings.API_V1_STR}/login/access-token",
        data={
            "username": settings.FIRST_SUPERUSER,
            "password": settings.FIRST_SUPERUSER_PASSWORD,
        },
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_login_returns_access_and_refresh_tokens(client: TestClient) -> None:
    tokens = _login(client)
    assert tokens["access_token"]
    assert tokens["refresh_token"]
    assert tokens["token_type"] == "bearer"


def test_access_token_authenticates_protected_route(client: TestClient) -> None:
    tokens = _login(client)
    r = client.get(
        f"{settings.API_V1_STR}/me",
        headers={"Authorization": f"Bearer {tokens['access_token']}"},
    )
    assert r.status_code == 200


def test_refresh_returns_new_working_tokens(client: TestClient) -> None:
    tokens = _login(client)
    r = client.post(
        f"{settings.API_V1_STR}/login/refresh-token",
        json={"refresh_token": tokens["refresh_token"]},
    )
    assert r.status_code == 200, r.text
    new_tokens = r.json()
    assert new_tokens["access_token"]
    assert new_tokens["refresh_token"]

    # The freshly minted access token authenticates a protected route.
    me = client.get(
        f"{settings.API_V1_STR}/me",
        headers={"Authorization": f"Bearer {new_tokens['access_token']}"},
    )
    assert me.status_code == 200


def test_access_token_rejected_at_refresh_endpoint(client: TestClient) -> None:
    """An access token is not a refresh token and must be rejected (type claim)."""
    tokens = _login(client)
    r = client.post(
        f"{settings.API_V1_STR}/login/refresh-token",
        json={"refresh_token": tokens["access_token"]},
    )
    assert r.status_code == 401


def test_refresh_token_rejected_as_bearer_credentials(client: TestClient) -> None:
    """A refresh token must not be usable as an access token on protected routes."""
    tokens = _login(client)
    r = client.get(
        f"{settings.API_V1_STR}/me",
        headers={"Authorization": f"Bearer {tokens['refresh_token']}"},
    )
    assert r.status_code == 401


def test_refresh_with_garbage_token_is_unauthorized(client: TestClient) -> None:
    r = client.post(
        f"{settings.API_V1_STR}/login/refresh-token",
        json={"refresh_token": "not-a-real-token"},
    )
    assert r.status_code == 401


# -----------------------------------------------------------------------------
# Social sign-in (POST /login/social-token)
#
# `verify_social_token` hits real Apple/Google JWKS endpoints over the
# network, so every test here patches it at the point `login.py` imported it,
# rather than making real HTTP calls.
# -----------------------------------------------------------------------------


def _post_social_token(
    client: TestClient,
    *,
    provider: str = "apple",
    token: str = "irrelevant",
    display_name: str | None = None,
) -> object:
    payload: dict[str, str] = {"provider": provider, "token": token}
    if display_name is not None:
        payload["display_name"] = display_name
    return client.post(f"{settings.API_V1_STR}/login/social-token", json=payload)


def test_social_token_creates_new_apple_user(
    client: TestClient,
    db_transaction: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    email = random_email()
    sub = f"apple-{uuid.uuid4()}"
    monkeypatch.setattr(
        "app.api.routes.login.verify_social_token",
        lambda provider, token: SocialClaims(sub=sub, email=email),
    )

    r = _post_social_token(client, provider="apple", display_name="Alice")
    assert r.status_code == 200, r.text
    tokens = r.json()
    assert tokens["access_token"]
    assert tokens["refresh_token"]

    user = user_crud.get_user_by_social_sub(
        session=db_transaction, provider=SocialProvider.APPLE, provider_sub=sub
    )
    assert user is not None
    assert user.email == email
    assert user.apple_sub == sub
    assert user.hashed_password is None
    assert user.display_name == "Alice"


def test_social_token_returning_user_reuses_account(
    client: TestClient,
    db_transaction: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    email = random_email()
    sub = f"apple-{uuid.uuid4()}"
    monkeypatch.setattr(
        "app.api.routes.login.verify_social_token",
        lambda provider, token: SocialClaims(sub=sub, email=email),
    )

    first = _post_social_token(client, provider="apple")
    assert first.status_code == 200, first.text
    second = _post_social_token(client, provider="apple")
    assert second.status_code == 200, second.text

    def _me_id(tokens: dict[str, str]) -> str:
        me = client.get(
            f"{settings.API_V1_STR}/me",
            headers={"Authorization": f"Bearer {tokens['access_token']}"},
        )
        assert me.status_code == 200
        return str(me.json()["id"])

    assert _me_id(first.json()) == _me_id(second.json())

    # No duplicate account was created for this Apple identity.
    matches = db_transaction.exec(
        select(User).where(User.apple_sub == sub)
    ).all()
    assert len(matches) == 1


def test_social_token_links_to_existing_password_account_by_email(
    client: TestClient,
    db_transaction: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    email = random_email()
    password = random_lower_string()
    existing = user_crud.create_user(
        session=db_transaction,
        user_create=UserCreate(email=email, password=password),
    )
    original_hash = existing.hashed_password
    google_sub = f"google-{uuid.uuid4()}"

    monkeypatch.setattr(
        "app.api.routes.login.verify_social_token",
        lambda provider, token: SocialClaims(sub=google_sub, email=email),
    )

    r = _post_social_token(client, provider="google")
    assert r.status_code == 200, r.text

    linked = user_crud.get_user_by_email(session=db_transaction, email=email)
    assert linked is not None
    assert linked.id == existing.id
    assert linked.google_sub == google_sub
    assert linked.hashed_password == original_hash

    # No duplicate account exists for this email.
    matches = db_transaction.exec(select(User).where(User.email == email)).all()
    assert len(matches) == 1


@pytest.mark.usefixtures("db_transaction")
def test_social_token_new_user_no_display_name_needs_username(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    email = random_email()
    sub = f"apple-{uuid.uuid4()}"
    monkeypatch.setattr(
        "app.api.routes.login.verify_social_token",
        lambda provider, token: SocialClaims(sub=sub, email=email),
    )

    r = _post_social_token(client, provider="apple")
    assert r.status_code == 200, r.text
    assert r.json()["needs_username"] is True


@pytest.mark.usefixtures("db_transaction")
def test_social_token_new_user_with_valid_display_name_no_username_needed(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    email = random_email()
    sub = f"apple-{uuid.uuid4()}"
    monkeypatch.setattr(
        "app.api.routes.login.verify_social_token",
        lambda provider, token: SocialClaims(sub=sub, email=email),
    )

    r = _post_social_token(client, provider="apple", display_name="alice123")
    assert r.status_code == 200, r.text
    assert r.json()["needs_username"] is False


@pytest.mark.usefixtures("db_transaction")
def test_social_token_new_user_with_invalid_display_name_needs_username(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    email = random_email()
    sub = f"apple-{uuid.uuid4()}"
    monkeypatch.setattr(
        "app.api.routes.login.verify_social_token",
        lambda provider, token: SocialClaims(sub=sub, email=email),
    )

    # "Jan de Vries" has spaces and is more than 15 characters long.
    r = _post_social_token(client, provider="apple", display_name="Jan de Vries")
    assert r.status_code == 200, r.text
    assert r.json()["needs_username"] is True


@pytest.mark.usefixtures("db_transaction")
def test_social_token_returning_user_with_valid_display_name_no_username_needed(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    email = random_email()
    sub = f"apple-{uuid.uuid4()}"
    monkeypatch.setattr(
        "app.api.routes.login.verify_social_token",
        lambda provider, token: SocialClaims(sub=sub, email=email),
    )

    first = _post_social_token(client, provider="apple", display_name="alice123")
    assert first.status_code == 200, first.text
    assert first.json()["needs_username"] is False

    second = _post_social_token(client, provider="apple")
    assert second.status_code == 200, second.text
    assert second.json()["needs_username"] is False


def test_social_token_link_to_existing_account_with_valid_display_name_no_username_needed(
    client: TestClient,
    db_transaction: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    email = random_email()
    password = random_lower_string()
    existing = user_crud.create_user(
        session=db_transaction,
        user_create=UserCreate(email=email, password=password),
    )
    existing.display_name = "alice123"
    db_transaction.add(existing)
    db_transaction.flush()

    google_sub = f"google-{uuid.uuid4()}"
    monkeypatch.setattr(
        "app.api.routes.login.verify_social_token",
        lambda provider, token: SocialClaims(sub=google_sub, email=email),
    )

    r = _post_social_token(client, provider="google")
    assert r.status_code == 200, r.text
    assert r.json()["needs_username"] is False


def test_social_token_invalid_token_is_unauthorized(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    def _raise(_provider: object, _token: str) -> SocialClaims:
        raise InvalidSocialToken("signature verification failed")

    monkeypatch.setattr("app.api.routes.login.verify_social_token", _raise)

    r = _post_social_token(client, provider="apple", token="garbage")
    assert r.status_code == 401


def test_social_token_inactive_user_rejected(
    client: TestClient,
    db_transaction: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    email = random_email()
    sub = f"apple-{uuid.uuid4()}"
    user, is_new = user_crud.get_or_create_social_user(
        session=db_transaction,
        provider=SocialProvider.APPLE,
        provider_sub=sub,
        email=email,
        display_name=None,
    )
    assert is_new
    user.is_active = False
    db_transaction.add(user)
    db_transaction.flush()

    monkeypatch.setattr(
        "app.api.routes.login.verify_social_token",
        lambda provider, token: SocialClaims(sub=sub, email=email),
    )

    r = _post_social_token(client, provider="apple")
    assert r.status_code == 400
    assert r.json()["detail"] == "Inactive user"


def test_authenticate_returns_none_for_social_only_account(
    db_transaction: Session,
) -> None:
    """A social-only account has no password hash to check against."""
    email = random_email()
    user_crud.get_or_create_social_user(
        session=db_transaction,
        provider=SocialProvider.GOOGLE,
        provider_sub=f"google-{uuid.uuid4()}",
        email=email,
        display_name=None,
    )

    result = user_crud.authenticate(
        session=db_transaction, email=email, password="whatever-password"
    )
    assert result is None


def test_social_only_account_cannot_login_via_password_endpoint(
    client: TestClient, db_transaction: Session
) -> None:
    email = random_email()
    user_crud.get_or_create_social_user(
        session=db_transaction,
        provider=SocialProvider.APPLE,
        provider_sub=f"apple-{uuid.uuid4()}",
        email=email,
        display_name=None,
    )

    r = client.post(
        f"{settings.API_V1_STR}/login/access-token",
        data={"username": email, "password": "whatever-password"},
    )
    assert r.status_code == 400
    assert r.json()["detail"] == "Incorrect email or password"
