"""Tests for login-by-email-or-username, permanently reserved social emails,
and the password confirmation required to change username/email.

See `test_login.py` for the pre-existing social sign-in linking behavior
(unchanged here) and `test_email_verification.py` for the confirmation-link
flow itself (also unchanged; only *when* it fires is new, on email change).
"""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.core.security import SocialClaims
from app.crud import user as user_crud
from app.models.user import UserCreate
from tests.utils.user import user_authentication_headers
from tests.utils.utils import random_email, random_lower_string


@pytest.fixture
def sent_emails(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, str]]:
    """Capture outgoing mail instead of handing it to SMTP."""
    captured: list[dict[str, str]] = []

    def _capture(*, email_to: str, subject: str = "", html_content: str = "") -> None:
        del subject, html_content
        captured.append({"email_to": email_to})

    monkeypatch.setattr("app.services.users.send_email", _capture)
    monkeypatch.setattr(settings, "SMTP_HOST", "smtp.example.com")
    monkeypatch.setattr(settings, "EMAILS_FROM_EMAIL", "noreply@example.com")
    return captured


def _patch_me(client: TestClient, headers: dict[str, str], **body) -> object:
    return client.patch(f"{settings.API_V1_STR}/me/", headers=headers, json=body)


def _login(client: TestClient, identifier: str, password: str) -> object:
    return client.post(
        f"{settings.API_V1_STR}/login/access-token",
        data={"username": identifier, "password": password},
    )


def test_full_scenario_google_signup_email_change_username_change_all_logins_work(
    client: TestClient,
    db_transaction: Session,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
    sent_emails: list[dict[str, str]],
) -> None:
    google_email = random_email()
    sub = f"google-{uuid.uuid4()}"
    monkeypatch.setattr(
        "app.api.routes.login.verify_social_token",
        lambda provider, token: SocialClaims(sub=sub, email=google_email),
    )

    r = client.post(
        f"{settings.API_V1_STR}/login/social-token",
        json={"provider": "google", "token": "irrelevant"},
    )
    assert r.status_code == 200, r.text
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}

    # Set a password.
    password = random_lower_string()
    r = client.patch(
        f"{settings.API_V1_STR}/me/password",
        headers=headers,
        json={"new_password": password},
    )
    assert r.status_code == 200, r.text

    # Change primary email; requires the just-set password.
    new_email = random_email()
    r = _patch_me(client, headers, email=new_email, current_password=password)
    assert r.status_code == 200, r.text
    assert r.json()["email_verified"] is False
    assert any(e["email_to"] == new_email for e in sent_emails)

    # Set a username.
    username = f"u{random_lower_string()[:10]}"
    r = _patch_me(client, headers, display_name=username, current_password=password)
    assert r.status_code == 200, r.text

    # All three identifiers log in with the same password.
    for identifier in (google_email, new_email, username):
        r = _login(client, identifier, password)
        assert r.status_code == 200, (identifier, r.text)

    # And case-insensitively.
    r = _login(client, username.upper(), password)
    assert r.status_code == 200, r.text
    r = _login(client, new_email.upper(), password)
    assert r.status_code == 200, r.text


def test_email_change_without_password_set_is_rejected(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    email = random_email()
    sub = f"apple-{uuid.uuid4()}"
    monkeypatch.setattr(
        "app.api.routes.login.verify_social_token",
        lambda provider, token: SocialClaims(sub=sub, email=email),
    )
    r = client.post(
        f"{settings.API_V1_STR}/login/social-token",
        json={"provider": "apple", "token": "irrelevant"},
    )
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}

    r = _patch_me(client, headers, email=random_email())
    assert r.status_code == 400, r.text


def test_username_change_with_wrong_password_is_rejected(
    client: TestClient, db_transaction: Session
) -> None:
    email = random_email()
    password = random_lower_string()
    user_crud.create_user(
        session=db_transaction, user_create=UserCreate(email=email, password=password)
    )
    headers = user_authentication_headers(client=client, email=email, password=password)

    r = _patch_me(
        client,
        headers,
        display_name=f"u{random_lower_string()[:10]}",
        current_password="definitely-wrong",
    )
    assert r.status_code == 400, r.text

    r = _patch_me(client, headers, display_name=f"u{random_lower_string()[:10]}")
    assert r.status_code == 400, r.text


def test_unrelated_field_update_does_not_require_password(
    client: TestClient, db_transaction: Session
) -> None:
    email = random_email()
    password = random_lower_string()
    user_crud.create_user(
        session=db_transaction, user_create=UserCreate(email=email, password=password)
    )
    headers = user_authentication_headers(client=client, email=email, password=password)

    r = _patch_me(client, headers, incognito_mode=True)
    assert r.status_code == 200, r.text


def test_email_taken_as_someone_elses_google_identity_is_rejected(
    client: TestClient,
    db_transaction: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # user_a reserves google_email as a Google-linked identity that is not
    # their current primary (their primary was set later).
    google_email = random_email()
    sub = f"google-{uuid.uuid4()}"
    monkeypatch.setattr(
        "app.api.routes.login.verify_social_token",
        lambda provider, token: SocialClaims(sub=sub, email=google_email),
    )
    r = client.post(
        f"{settings.API_V1_STR}/login/social-token",
        json={"provider": "google", "token": "irrelevant"},
    )
    headers_a = {"Authorization": f"Bearer {r.json()['access_token']}"}
    password_a = random_lower_string()
    client.patch(
        f"{settings.API_V1_STR}/me/password",
        headers=headers_a,
        json={"new_password": password_a},
    )
    r = _patch_me(client, headers_a, email=random_email(), current_password=password_a)
    assert r.status_code == 200, r.text

    # user_b tries to claim google_email as their own primary — must fail even
    # though it is nobody's *current* primary.
    email_b = random_email()
    password_b = random_lower_string()
    user_crud.create_user(
        session=db_transaction,
        user_create=UserCreate(email=email_b, password=password_b),
    )
    headers_b = user_authentication_headers(
        client=client, email=email_b, password=password_b
    )
    r = _patch_me(client, headers_b, email=google_email, current_password=password_b)
    assert r.status_code == 409, r.text


def test_registering_with_someone_elses_reserved_google_email_is_rejected(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # The Google email must be reserved but must NOT be anyone's *current*
    # primary — otherwise the collision would be caught by User.email's own
    # unique index instead of exercising the new cross-source check.
    google_email = random_email()
    sub = f"google-{uuid.uuid4()}"
    monkeypatch.setattr(
        "app.api.routes.login.verify_social_token",
        lambda provider, token: SocialClaims(sub=sub, email=google_email),
    )
    r = client.post(
        f"{settings.API_V1_STR}/login/social-token",
        json={"provider": "google", "token": "irrelevant"},
    )
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
    password = random_lower_string()
    client.patch(
        f"{settings.API_V1_STR}/me/password",
        headers=headers,
        json={"new_password": password},
    )
    r = _patch_me(client, headers, email=random_email(), current_password=password)
    assert r.status_code == 200, r.text

    r = client.post(
        f"{settings.API_V1_STR}/users/signup",
        json={
            "email": google_email,
            "password": random_lower_string(),
            "display_name": f"u{random_lower_string()[:10]}",
        },
    )
    assert r.status_code == 409, r.text


def test_login_by_username(client: TestClient, db_transaction: Session) -> None:
    email = random_email()
    password = random_lower_string()
    username = f"u{random_lower_string()[:10]}"
    user_crud.create_user(
        session=db_transaction,
        user_create=UserCreate(
            email=email, password=password, display_name=username
        ),
    )
    r = _login(client, username, password)
    assert r.status_code == 200, r.text
    r = _login(client, "not-a-real-user", password)
    assert r.status_code == 400
    r = _login(client, username, "wrong-password")
    assert r.status_code == 400


def test_social_login_survives_email_now_colliding_with_another_users_reserved_email(
    client: TestClient,
    db_transaction: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # user_b already reserves `colliding_email` as their primary.
    colliding_email = random_email()
    user_crud.create_user(
        session=db_transaction,
        user_create=UserCreate(
            email=colliding_email, password=random_lower_string()
        ),
    )

    # user_a signs in via Google with a distinct email first...
    sub = f"google-{uuid.uuid4()}"
    first_email = random_email()
    monkeypatch.setattr(
        "app.api.routes.login.verify_social_token",
        lambda provider, token: SocialClaims(sub=sub, email=first_email),
    )
    r = client.post(
        f"{settings.API_V1_STR}/login/social-token",
        json={"provider": "google", "token": "irrelevant"},
    )
    assert r.status_code == 200, r.text
    user_a_id = uuid.UUID(
        client.get(
            f"{settings.API_V1_STR}/me",
            headers={"Authorization": f"Bearer {r.json()['access_token']}"},
        ).json()["id"]
    )

    # ...then Google now reports the email that user_b already holds. The
    # sub match must still succeed and must not raise, even though the
    # reservation attempt for the new email is impossible.
    monkeypatch.setattr(
        "app.api.routes.login.verify_social_token",
        lambda provider, token: SocialClaims(sub=sub, email=colliding_email),
    )
    r = client.post(
        f"{settings.API_V1_STR}/login/social-token",
        json={"provider": "google", "token": "irrelevant"},
    )
    assert r.status_code == 200, r.text
    same_user_id = uuid.UUID(
        client.get(
            f"{settings.API_V1_STR}/me",
            headers={"Authorization": f"Bearer {r.json()['access_token']}"},
        ).json()["id"]
    )
    assert same_user_id == user_a_id

    # user_b's own reservation of colliding_email is untouched.
    owner = user_crud.get_user_by_login_email(session=db_transaction, email=colliding_email)
    assert owner is not None
    assert owner.id != user_a_id
