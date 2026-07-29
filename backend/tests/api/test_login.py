"""Tests for the login + refresh-token auth flow."""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func
from sqlmodel import Session, col, select

from app.api.routes.login import _build_token
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


def test_token_for_deleted_user_is_unauthorized_not_not_found(
    client: TestClient, db_transaction: Session
) -> None:
    """A token naming a user that no longer exists is a dead credential (401).

    It used to be a 404, which the client could not tell apart from a genuinely
    missing resource: it never cleared the session, so the app retried forever
    with a token that could never work and could not even reach its own logout.
    Staging hits this on every deploy, because its DB is reseeded from prod.
    """
    user = user_crud.create_user(
        session=db_transaction,
        user_create=UserCreate(email=random_email(), password=random_lower_string()),
    )
    tokens = _build_token(user.id)
    db_transaction.delete(user)
    db_transaction.commit()

    r = client.get(
        f"{settings.API_V1_STR}/me",
        headers={"Authorization": f"Bearer {tokens.access_token}"},
    )
    assert r.status_code == 401, r.text

    # And the refresh path agrees, so the client gives up and returns to login
    # instead of refreshing its way into the same wall.
    refreshed = client.post(
        f"{settings.API_V1_STR}/login/refresh-token",
        json={"refresh_token": tokens.refresh_token},
    )
    assert refreshed.status_code == 401, refreshed.text


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
) -> object:
    payload: dict[str, str] = {"provider": provider, "token": token}
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

    r = _post_social_token(client, provider="apple")
    assert r.status_code == 200, r.text
    tokens = r.json()
    assert tokens["access_token"]
    assert tokens["refresh_token"]
    assert tokens["needs_username"] is True

    user = user_crud.get_user_by_social_sub(
        session=db_transaction, provider=SocialProvider.APPLE, provider_sub=sub
    )
    assert user is not None
    assert user.email == email
    assert user.apple_sub == sub
    assert user.hashed_password is None
    assert user.display_name is None


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
    # Confirmed, so this is the ordinary link and the password is left alone.
    # Linking into an *unverified* account deliberately discards it — see
    # test_social_token_linking_into_an_unverified_account_drops_its_password.
    existing.email_verified = True
    db_transaction.add(existing)
    db_transaction.flush()
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
    assert r.json()["password_removed"] is False

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
def test_social_token_returning_user_who_already_picked_username_no_username_needed(
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
    assert first.json()["needs_username"] is True

    # Simulates the client completing the pick-username screen after account
    # creation, via the normal /me update path (not exercised here).
    user = user_crud.get_user_by_social_sub(
        session=db_transaction, provider=SocialProvider.APPLE, provider_sub=sub
    )
    assert user is not None
    user.display_name = "alice123"
    db_transaction.add(user)
    db_transaction.flush()

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


def test_social_token_links_to_password_account_with_differently_cased_email(
    client: TestClient,
    db_transaction: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Signing in with Google reaches the account you registered by email.

    Providers hand back a lowercased address, so an account registered as
    `Bob@example.com` was missed by an exact-match lookup and the sign-in
    quietly created a second, empty account beside the real one. One mailbox is
    one account, whatever the capitalisation.
    """
    local_part = random_lower_string()[:10]
    registered_email = f"Mixed.{local_part}@Example.com"
    existing = user_crud.create_user(
        session=db_transaction,
        user_create=UserCreate(
            email=registered_email, password=random_lower_string()
        ),
    )
    existing.display_name = "alice123"
    db_transaction.add(existing)
    db_transaction.flush()
    existing_id = existing.id

    google_sub = f"google-{uuid.uuid4()}"
    monkeypatch.setattr(
        "app.api.routes.login.verify_social_token",
        lambda provider, token: SocialClaims(
            sub=google_sub, email=registered_email.lower()
        ),
    )

    r = _post_social_token(client, provider="google")

    assert r.status_code == 200, r.text
    # Straight in: the account already has a username, so the client skips
    # /pick-username and never marks the first-run intro pending.
    assert r.json()["needs_username"] is False

    matching_users = db_transaction.exec(
        select(User).where(func.lower(col(User.email)) == registered_email.lower())
    ).all()
    assert len(matching_users) == 1
    linked = matching_users[0]
    assert linked.id == existing_id
    assert linked.google_sub == google_sub
    assert linked.display_name == "alice123"
    # The address is left exactly as the user typed it when registering.
    assert linked.email == registered_email


def test_social_token_new_account_is_verified_by_the_provider(
    client: TestClient,
    db_transaction: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A provider-signed `email_verified` is proof enough; no link is mailed."""
    email = random_email()
    sub = f"google-{uuid.uuid4()}"
    monkeypatch.setattr(
        "app.api.routes.login.verify_social_token",
        lambda provider, token: SocialClaims(sub=sub, email=email),
    )

    r = _post_social_token(client, provider="google")

    assert r.status_code == 200, r.text
    created = user_crud.get_user_by_social_sub(
        session=db_transaction, provider=SocialProvider.GOOGLE, provider_sub=sub
    )
    assert created is not None
    assert created.email_verified is True


def test_social_token_linking_into_a_verified_account_keeps_its_password(
    client: TestClient,
    db_transaction: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The ordinary case: you confirmed your address, then added Google."""
    email = random_email()
    existing = user_crud.create_user(
        session=db_transaction,
        user_create=UserCreate(email=email, password=random_lower_string()),
    )
    existing.display_name = "alice123"
    existing.email_verified = True
    db_transaction.add(existing)
    db_transaction.flush()
    password_hash = existing.hashed_password

    monkeypatch.setattr(
        "app.api.routes.login.verify_social_token",
        lambda provider, token: SocialClaims(
            sub=f"google-{uuid.uuid4()}", email=email
        ),
    )

    r = _post_social_token(client, provider="google")

    assert r.status_code == 200, r.text
    db_transaction.expire_all()
    linked = user_crud.get_user_by_email(session=db_transaction, email=email)
    assert linked is not None
    assert linked.hashed_password == password_hash
    assert linked.email_verified is True


def test_social_token_linking_into_an_unverified_account_drops_its_password(
    client: TestClient,
    db_transaction: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Registering someone else's address must not become a way into it.

    Signup takes the address on trust, so an account nobody confirmed carries an
    unproven password. When a provider then proves who owns that mailbox, the
    proven owner gets the account and the unproven credential is discarded —
    otherwise whoever pre-registered the address would still hold a key to it.
    """
    email = random_email()
    squatter = user_crud.create_user(
        session=db_transaction,
        user_create=UserCreate(email=email, password=random_lower_string()),
    )
    squatter.display_name = "squatter1"
    db_transaction.add(squatter)
    db_transaction.flush()
    assert squatter.email_verified is False
    squatter_id = squatter.id

    monkeypatch.setattr(
        "app.api.routes.login.verify_social_token",
        lambda provider, token: SocialClaims(
            sub=f"google-{uuid.uuid4()}", email=email
        ),
    )

    r = _post_social_token(client, provider="google")

    assert r.status_code == 200, r.text
    db_transaction.expire_all()
    linked = user_crud.get_user_by_email(session=db_transaction, email=email)
    assert linked is not None
    # Same account — the real owner lands where their data would have gone.
    assert linked.id == squatter_id
    assert linked.email_verified is True
    assert linked.hashed_password is None
    # Reported back so the app can tell the user, rather than leaving them to
    # discover it the next time they try that password.
    assert r.json()["password_removed"] is True


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
    resolution = user_crud.get_or_create_social_user(
        session=db_transaction,
        provider=SocialProvider.APPLE,
        provider_sub=sub,
        email=email,
    )
    assert resolution.is_new
    user = resolution.user
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
    )

    r = client.post(
        f"{settings.API_V1_STR}/login/access-token",
        data={"username": email, "password": "whatever-password"},
    )
    assert r.status_code == 400
    assert r.json()["detail"] == "Incorrect email or password"
