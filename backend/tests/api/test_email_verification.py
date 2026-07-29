"""Tests for confirming that an account owns the address it registered with.

Registration used to take the address on trust, which is what made linking a
social identity to an existing account risky: the provider proves the address,
but the account being linked into never had. These cover the confirmation link
itself; the linking rules it exists for live in `test_login.py`.
"""

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.core.enums import NotificationChannel
from app.core.security import (
    generate_email_verification_token,
    generate_password_reset_token,
    verify_password_reset_token,
)
from app.models.user import User
from tests.utils.utils import random_email, random_lower_string


@pytest.fixture
def sent_emails(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, str]]:
    """Capture outgoing mail instead of handing it to SMTP."""
    captured: list[dict[str, str]] = []

    def _capture(*, email_to: str, subject: str = "", html_content: str = "") -> None:
        captured.append(
            {"email_to": email_to, "subject": subject, "html_content": html_content}
        )

    monkeypatch.setattr("app.services.users.send_email", _capture)
    monkeypatch.setattr(settings, "SMTP_HOST", "smtp.example.com")
    monkeypatch.setattr(settings, "EMAILS_FROM_EMAIL", "noreply@example.com")
    return captured


def _signup(client: TestClient, email: str) -> None:
    r = client.post(
        f"{settings.API_V1_STR}/users/signup",
        json={
            "email": email,
            "password": random_lower_string(),
            "display_name": f"u{random_lower_string()[:10]}",
        },
    )
    assert r.status_code == 200, r.text


def _get_user(session: Session, email: str) -> User:
    return session.exec(select(User).where(User.email == email)).one()


def _make_digest_tip_candidate(session: Session, user_factory) -> User:
    """Put the test user in the one state the digest tip is offered in.

    The Letterboxd username is borrowed from a factory-made user because the
    column is a foreign key — an arbitrary string has no row to point at.
    """
    user = session.exec(
        select(User).where(User.email == settings.EMAIL_TEST_USER)
    ).one()
    user.email_verified = True
    user.watchlist_digest_ever_enabled = False
    user.notify_watchlist_digest_enabled = False
    user.letterboxd_username = user_factory().letterboxd_username
    session.add(user)
    session.commit()
    return user


def test_signup_creates_an_unverified_account_and_mails_a_link(
    client: TestClient,
    db_transaction: Session,
    sent_emails: list[dict[str, str]],
) -> None:
    email = random_email()

    _signup(client, email)

    assert _get_user(db_transaction, email).email_verified is False
    assert [mail["email_to"] for mail in sent_emails] == [email]
    assert "/users/verify-email?token=" in sent_emails[0]["html_content"]


def test_signup_still_succeeds_when_the_verification_email_fails(
    client: TestClient,
    db_transaction: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A registration is not undone because SMTP had a bad minute."""
    monkeypatch.setattr(settings, "SMTP_HOST", "smtp.example.com")
    monkeypatch.setattr(settings, "EMAILS_FROM_EMAIL", "noreply@example.com")

    def _explode(**_kwargs: object) -> None:
        raise RuntimeError("smtp is down")

    monkeypatch.setattr("app.services.users.send_email", _explode)
    email = random_email()

    _signup(client, email)

    assert _get_user(db_transaction, email).email_verified is False


def test_verification_link_confirms_the_account(
    client: TestClient,
    db_transaction: Session,
    sent_emails: list[dict[str, str]],
) -> None:
    email = random_email()
    _signup(client, email)
    assert sent_emails[0]["email_to"] == email
    token = generate_email_verification_token(email=email)

    r = client.get(f"{settings.API_V1_STR}/users/verify-email", params={"token": token})

    assert r.status_code == 200
    db_transaction.expire_all()
    assert _get_user(db_transaction, email).email_verified is True


def test_verification_link_can_be_clicked_twice(
    client: TestClient,
    db_transaction: Session,
    sent_emails: list[dict[str, str]],
) -> None:
    """A second click is a normal thing to do and gets the same answer."""
    email = random_email()
    _signup(client, email)
    assert sent_emails[0]["email_to"] == email
    token = generate_email_verification_token(email=email)
    params = {"token": token}

    assert (
        client.get(f"{settings.API_V1_STR}/users/verify-email", params=params).status_code
        == 200
    )
    assert (
        client.get(f"{settings.API_V1_STR}/users/verify-email", params=params).status_code
        == 200
    )
    db_transaction.expire_all()
    assert _get_user(db_transaction, email).email_verified is True


def test_verification_link_rejects_garbage(client: TestClient) -> None:
    r = client.get(
        f"{settings.API_V1_STR}/users/verify-email", params={"token": "not-a-token"}
    )

    assert r.status_code == 400


def test_verification_link_rejects_a_password_reset_token(
    client: TestClient,
    db_transaction: Session,
    sent_emails: list[dict[str, str]],
) -> None:
    """Tokens are scoped to the job they were minted for.

    Every mailed link carries the same `sub`, so without the `type` claim a
    reset token would double as permission to confirm an address.
    """
    email = random_email()
    _signup(client, email)
    assert sent_emails[0]["email_to"] == email
    reset_token = generate_password_reset_token(email=email)

    r = client.get(
        f"{settings.API_V1_STR}/users/verify-email", params={"token": reset_token}
    )

    assert r.status_code == 400
    db_transaction.expire_all()
    assert _get_user(db_transaction, email).email_verified is False


def test_password_reset_rejects_an_email_verification_token() -> None:
    """And the same rule in the other direction, which matters far more.

    A confirmation link sits in an inbox for two weeks; it must never be
    redeemable as permission to set a new password.
    """
    email = random_email()

    assert verify_password_reset_token(generate_email_verification_token(email)) is None
    # The untyped reset token itself still works — existing links stay valid.
    assert verify_password_reset_token(generate_password_reset_token(email)) == email


def test_resend_verification_mails_another_link(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    sent_emails: list[dict[str, str]],
) -> None:
    user = db_transaction.exec(
        select(User).where(User.email == settings.EMAIL_TEST_USER)
    ).one()
    user.email_verified = False
    db_transaction.add(user)
    db_transaction.commit()

    r = client.post(
        f"{settings.API_V1_STR}/me/resend-verification",
        headers=normal_user_token_headers,
    )

    assert r.status_code == 200
    assert [mail["email_to"] for mail in sent_emails] == [settings.EMAIL_TEST_USER]


def test_unverified_account_cannot_enable_the_watchlist_digest(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
) -> None:
    """Recurring mail waits for proof that the address reaches someone.

    An unconfirmed address is quite possibly a stranger's, and a weekly email
    they never asked for is how a sender ends up in spam folders.
    """
    user = db_transaction.exec(
        select(User).where(User.email == settings.EMAIL_TEST_USER)
    ).one()
    user.email_verified = False
    user.notify_watchlist_digest_enabled = False
    db_transaction.add(user)
    db_transaction.commit()

    r = client.patch(
        f"{settings.API_V1_STR}/me/",
        headers=normal_user_token_headers,
        json={"notify_watchlist_digest_enabled": True},
    )

    assert r.status_code == 403
    db_transaction.expire_all()
    refreshed = db_transaction.exec(
        select(User).where(User.email == settings.EMAIL_TEST_USER)
    ).one()
    assert refreshed.notify_watchlist_digest_enabled is False


def test_unverified_account_cannot_route_notifications_to_email(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
) -> None:
    """The digest is not the only way to point something at an inbox."""
    user = db_transaction.exec(
        select(User).where(User.email == settings.EMAIL_TEST_USER)
    ).one()
    user.email_verified = False
    user.notify_channel_friend_requests = NotificationChannel.PUSH
    db_transaction.add(user)
    db_transaction.commit()

    r = client.patch(
        f"{settings.API_V1_STR}/me/",
        headers=normal_user_token_headers,
        json={"notify_channel_friend_requests": "email"},
    )

    assert r.status_code == 403
    db_transaction.expire_all()
    refreshed = db_transaction.exec(
        select(User).where(User.email == settings.EMAIL_TEST_USER)
    ).one()
    assert refreshed.notify_channel_friend_requests == NotificationChannel.PUSH


def test_unverified_account_can_still_switch_a_channel_back_to_push(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
) -> None:
    """Only opting *into* email is gated, never the way out of it."""
    user = db_transaction.exec(
        select(User).where(User.email == settings.EMAIL_TEST_USER)
    ).one()
    user.email_verified = False
    user.notify_channel_showtime_ping = NotificationChannel.EMAIL
    db_transaction.add(user)
    db_transaction.commit()

    r = client.patch(
        f"{settings.API_V1_STR}/me/",
        headers=normal_user_token_headers,
        json={"notify_channel_showtime_ping": "push"},
    )

    assert r.status_code == 200
    assert r.json()["notify_channel_showtime_ping"] == "push"


def test_verified_account_can_route_notifications_to_email(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
) -> None:
    user = db_transaction.exec(
        select(User).where(User.email == settings.EMAIL_TEST_USER)
    ).one()
    user.email_verified = True
    db_transaction.add(user)
    db_transaction.commit()

    r = client.patch(
        f"{settings.API_V1_STR}/me/",
        headers=normal_user_token_headers,
        json={"notify_channel_friend_requests": "email"},
    )

    assert r.status_code == 200
    assert r.json()["notify_channel_friend_requests"] == "email"


def test_unverified_account_can_still_turn_the_digest_off(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
) -> None:
    """Only switching it *on* is gated — never the way out of it."""
    user = db_transaction.exec(
        select(User).where(User.email == settings.EMAIL_TEST_USER)
    ).one()
    user.email_verified = False
    user.notify_watchlist_digest_enabled = True
    db_transaction.add(user)
    db_transaction.commit()

    r = client.patch(
        f"{settings.API_V1_STR}/me/",
        headers=normal_user_token_headers,
        json={"notify_watchlist_digest_enabled": False},
    )

    assert r.status_code == 200
    assert r.json()["notify_watchlist_digest_enabled"] is False


def test_verified_account_can_enable_the_watchlist_digest(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
) -> None:
    user = db_transaction.exec(
        select(User).where(User.email == settings.EMAIL_TEST_USER)
    ).one()
    user.email_verified = True
    db_transaction.add(user)
    db_transaction.commit()

    r = client.patch(
        f"{settings.API_V1_STR}/me/",
        headers=normal_user_token_headers,
        json={"notify_watchlist_digest_enabled": True},
    )

    assert r.status_code == 200
    assert r.json()["notify_watchlist_digest_enabled"] is True


def test_watchlist_digest_tip_stays_off_until_the_backend_switch_is_on(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    monkeypatch: pytest.MonkeyPatch,
    user_factory,
) -> None:
    """The feature is reachable in Settings but nothing advertises it yet.

    Flipping the env var is the whole rollout — no client release involved.
    """
    _make_digest_tip_candidate(db_transaction, user_factory)

    monkeypatch.setattr(settings, "WATCHLIST_DIGEST_TIP_ENABLED", False)
    off = client.get(f"{settings.API_V1_STR}/me", headers=normal_user_token_headers)
    assert off.json()["show_watchlist_digest_tip"] is False

    monkeypatch.setattr(settings, "WATCHLIST_DIGEST_TIP_ENABLED", True)
    on = client.get(f"{settings.API_V1_STR}/me", headers=normal_user_token_headers)
    assert on.json()["show_watchlist_digest_tip"] is True


def test_watchlist_digest_tip_is_not_offered_to_an_unverified_account(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    monkeypatch: pytest.MonkeyPatch,
    user_factory,
) -> None:
    """Nothing offers a feature the account would not be allowed to turn on."""
    user = _make_digest_tip_candidate(db_transaction, user_factory)
    user.email_verified = False
    db_transaction.add(user)
    db_transaction.commit()
    monkeypatch.setattr(settings, "WATCHLIST_DIGEST_TIP_ENABLED", True)

    r = client.get(f"{settings.API_V1_STR}/me", headers=normal_user_token_headers)

    assert r.json()["show_watchlist_digest_tip"] is False


def test_watchlist_digest_tip_is_not_offered_without_a_letterboxd_account(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    monkeypatch: pytest.MonkeyPatch,
    user_factory,
) -> None:
    """A deliberately narrow first audience, not a limit of the digest itself.

    The digest can follow a public Letterboxd list instead of a connected
    account; this is only about who gets told it exists for now.
    """
    user = _make_digest_tip_candidate(db_transaction, user_factory)
    user.letterboxd_username = None
    db_transaction.add(user)
    db_transaction.commit()
    monkeypatch.setattr(settings, "WATCHLIST_DIGEST_TIP_ENABLED", True)

    r = client.get(f"{settings.API_V1_STR}/me", headers=normal_user_token_headers)

    assert r.json()["show_watchlist_digest_tip"] is False


def test_enabling_the_digest_retires_its_tip_for_good(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    monkeypatch: pytest.MonkeyPatch,
    user_factory,
) -> None:
    """Turning it on and off again is a decision, not a reason to be re-pitched."""
    _make_digest_tip_candidate(db_transaction, user_factory)
    monkeypatch.setattr(settings, "WATCHLIST_DIGEST_TIP_ENABLED", True)

    enabled = client.patch(
        f"{settings.API_V1_STR}/me/",
        headers=normal_user_token_headers,
        json={"notify_watchlist_digest_enabled": True},
    )
    assert enabled.status_code == 200
    assert enabled.json()["show_watchlist_digest_tip"] is False

    turned_back_off = client.patch(
        f"{settings.API_V1_STR}/me/",
        headers=normal_user_token_headers,
        json={"notify_watchlist_digest_enabled": False},
    )
    assert turned_back_off.status_code == 200
    assert turned_back_off.json()["show_watchlist_digest_tip"] is False


def test_resend_verification_is_a_no_op_for_a_verified_account(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    sent_emails: list[dict[str, str]],
) -> None:
    """Answered identically either way — it reveals nothing and does nothing."""
    user = db_transaction.exec(
        select(User).where(User.email == settings.EMAIL_TEST_USER)
    ).one()
    user.email_verified = True
    db_transaction.add(user)
    db_transaction.commit()

    r = client.post(
        f"{settings.API_V1_STR}/me/resend-verification",
        headers=normal_user_token_headers,
    )

    assert r.status_code == 200
    assert sent_emails == []
