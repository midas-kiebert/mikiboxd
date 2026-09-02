"""Tests for the email-change → push/digest-off → verify → restore cycle.

When an account's email changes, the new address starts unverified — see
`test_email_verification.py` for the underlying "an unverified account may
never opt into email delivery" rule. These tests cover the extra behavior
layered on top of an *existing* verified user's email change: any
notification channel already pointed at email, and the watchlist digest if
it was on, are switched to push/off automatically rather than left silently
routing to (or gated behind) an address nobody has confirmed yet — and both
are restored automatically once the new address is confirmed, whether by the
`/users/verify-email` link or by a social sign-in that proves the same
address.
"""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.core.enums import NotificationChannel
from app.core.security import SocialClaims, generate_email_verification_token
from app.crud import user as user_crud
from app.models.user import User, UserCreate
from tests.utils.user import user_authentication_headers
from tests.utils.utils import random_email, random_lower_string


@pytest.fixture
def sent_emails(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, str]]:
    """Capture outgoing mail instead of handing it to SMTP."""
    captured: list[dict[str, str]] = []

    # `**_rest` rather than the exact signature: every caller of the real
    # `send_email` wraps it in `except Exception`, so a keyword this stand-in
    # has not caught up with (`text_content`, `attachments`) does not fail
    # here — it is swallowed there, and the mail simply never arrives, which
    # reads as a missing feature rather than a stale double.
    def _capture(
        *, email_to: str, subject: str = "", html_content: str = "", **_rest: object
    ) -> None:
        del subject, html_content
        captured.append({"email_to": email_to})

    monkeypatch.setattr("app.services.users.send_email", _capture)
    monkeypatch.setattr(settings, "SMTP_HOST", "smtp.example.com")
    monkeypatch.setattr(settings, "EMAILS_FROM_EMAIL", "noreply@example.com")
    return captured


def _make_verified_user_with_password(
    db: Session, *, password: str
) -> tuple[User, str]:
    """A verified account with a known password, ready to change its email."""
    email = random_email()
    user = user_crud.create_user(
        session=db, user_create=UserCreate(email=email, password=password)
    )
    user.email_verified = True
    db.add(user)
    db.commit()
    db.refresh(user)
    return user, email


def _get_user(session: Session, user_id: uuid.UUID) -> User:
    session.expire_all()
    return session.exec(select(User).where(User.id == user_id)).one()


def _patch_me(
    client: TestClient, headers: dict[str, str], **body: object
) -> object:
    return client.patch(f"{settings.API_V1_STR}/me/", headers=headers, json=body)


def test_email_change_switches_email_channels_to_push_and_disables_digest(
    client: TestClient,
    db_transaction: Session,
    sent_emails: list[dict[str, str]],  # noqa: ARG001
) -> None:
    password = random_lower_string()
    user, old_email = _make_verified_user_with_password(db_transaction, password=password)
    user.notify_channel_friend_requests = NotificationChannel.EMAIL
    user.notify_channel_showtime_ping = NotificationChannel.EMAIL
    user.notify_watchlist_digest_enabled = True
    db_transaction.add(user)
    db_transaction.commit()
    user_id = user.id

    headers = user_authentication_headers(client=client, email=old_email, password=password)
    new_email = random_email()

    r = _patch_me(client, headers, email=new_email, current_password=password)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["email_verified"] is False
    assert body["notify_channel_friend_requests"] == "push"
    assert body["notify_channel_showtime_ping"] == "push"
    assert body["notify_watchlist_digest_enabled"] is False

    refreshed = _get_user(db_transaction, user_id)
    assert refreshed.email == new_email
    assert refreshed.email_verified is False
    assert refreshed.notify_channel_friend_requests == NotificationChannel.PUSH
    assert refreshed.notify_channel_showtime_ping == NotificationChannel.PUSH
    assert refreshed.notify_watchlist_digest_enabled is False
    assert sorted(refreshed.unverified_email_saved_channels or []) == sorted(
        [
            "notify_channel_friend_requests",
            "notify_channel_showtime_ping",
        ]
    )
    assert refreshed.unverified_email_saved_digest_enabled is True
    # Channels that were never on email are not recorded as saved.
    assert refreshed.notify_channel_friend_showtime_match == NotificationChannel.PUSH
    assert refreshed.notify_channel_invite_response == NotificationChannel.PUSH


def test_verifying_new_email_restores_previous_channels_and_digest(
    client: TestClient,
    db_transaction: Session,
    sent_emails: list[dict[str, str]],  # noqa: ARG001
) -> None:
    password = random_lower_string()
    user, old_email = _make_verified_user_with_password(db_transaction, password=password)
    user.notify_channel_friend_requests = NotificationChannel.EMAIL
    user.notify_channel_interest_reminder = NotificationChannel.EMAIL
    user.notify_watchlist_digest_enabled = True
    db_transaction.add(user)
    db_transaction.commit()
    user_id = user.id

    headers = user_authentication_headers(client=client, email=old_email, password=password)
    new_email = random_email()
    r = _patch_me(client, headers, email=new_email, current_password=password)
    assert r.status_code == 200, r.text

    token = generate_email_verification_token(email=new_email)
    verify_response = client.get(
        f"{settings.API_V1_STR}/users/verify-email", params={"token": token}
    )
    assert verify_response.status_code == 200

    restored = _get_user(db_transaction, user_id)
    assert restored.email_verified is True
    assert restored.notify_channel_friend_requests == NotificationChannel.EMAIL
    assert restored.notify_channel_interest_reminder == NotificationChannel.EMAIL
    assert restored.notify_watchlist_digest_enabled is True
    assert restored.unverified_email_saved_channels is None
    assert restored.unverified_email_saved_digest_enabled is False
    # Untouched channels are unaffected either way.
    assert restored.notify_channel_friend_showtime_match == NotificationChannel.PUSH


def test_second_email_change_while_unverified_does_not_clobber_original_snapshot(
    client: TestClient,
    db_transaction: Session,
    sent_emails: list[dict[str, str]],  # noqa: ARG001
) -> None:
    """A second email change before the first is confirmed must not overwrite
    the saved preferences with the already-switched-to-push state — otherwise
    verifying at the end would restore nothing instead of the originals.
    """
    password = random_lower_string()
    user, old_email = _make_verified_user_with_password(db_transaction, password=password)
    user.notify_channel_friend_requests = NotificationChannel.EMAIL
    user.notify_watchlist_digest_enabled = True
    db_transaction.add(user)
    db_transaction.commit()
    user_id = user.id

    headers = user_authentication_headers(client=client, email=old_email, password=password)

    # First email change: verified -> unverified, snapshot taken.
    first_new_email = random_email()
    r = _patch_me(client, headers, email=first_new_email, current_password=password)
    assert r.status_code == 200, r.text
    after_first = _get_user(db_transaction, user_id)
    assert after_first.email_verified is False
    assert after_first.unverified_email_saved_channels == ["notify_channel_friend_requests"]
    assert after_first.unverified_email_saved_digest_enabled is True

    # Second email change while still unverified: snapshot step is skipped
    # entirely, since the account is already in the "pushed" state.
    second_new_email = random_email()
    r = _patch_me(client, headers, email=second_new_email, current_password=password)
    assert r.status_code == 200, r.text
    after_second = _get_user(db_transaction, user_id)
    assert after_second.email == second_new_email
    assert after_second.email_verified is False
    assert after_second.unverified_email_saved_channels == ["notify_channel_friend_requests"]
    assert after_second.unverified_email_saved_digest_enabled is True

    # Verifying the final address restores the *original* pre-change state.
    token = generate_email_verification_token(email=second_new_email)
    verify_response = client.get(
        f"{settings.API_V1_STR}/users/verify-email", params={"token": token}
    )
    assert verify_response.status_code == 200

    restored = _get_user(db_transaction, user_id)
    assert restored.email_verified is True
    assert restored.notify_channel_friend_requests == NotificationChannel.EMAIL
    assert restored.notify_watchlist_digest_enabled is True
    assert restored.unverified_email_saved_channels is None
    assert restored.unverified_email_saved_digest_enabled is False


def test_email_change_with_no_email_preferences_is_a_no_op(
    client: TestClient,
    db_transaction: Session,
    sent_emails: list[dict[str, str]],  # noqa: ARG001
) -> None:
    """Nothing to switch, nothing to restore: the saved-state fields stay empty."""
    password = random_lower_string()
    user, old_email = _make_verified_user_with_password(db_transaction, password=password)
    user_id = user.id
    assert user.notify_watchlist_digest_enabled is False
    assert user.notify_channel_friend_requests == NotificationChannel.PUSH

    headers = user_authentication_headers(client=client, email=old_email, password=password)
    new_email = random_email()

    r = _patch_me(client, headers, email=new_email, current_password=password)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["email_verified"] is False
    assert body["notify_watchlist_digest_enabled"] is False

    after_change = _get_user(db_transaction, user_id)
    assert after_change.unverified_email_saved_channels is None
    assert after_change.unverified_email_saved_digest_enabled is False

    token = generate_email_verification_token(email=new_email)
    verify_response = client.get(
        f"{settings.API_V1_STR}/users/verify-email", params={"token": token}
    )
    assert verify_response.status_code == 200

    restored = _get_user(db_transaction, user_id)
    assert restored.email_verified is True
    assert restored.notify_watchlist_digest_enabled is False
    assert restored.notify_channel_friend_requests == NotificationChannel.PUSH
    assert restored.unverified_email_saved_channels is None
    assert restored.unverified_email_saved_digest_enabled is False


def test_social_signin_restores_saved_preferences_via_linking_unverified_account(
    client: TestClient,
    db_transaction: Session,
    monkeypatch: pytest.MonkeyPatch,
    sent_emails: list[dict[str, str]],  # noqa: ARG001
) -> None:
    """The other restore path: a Google/Apple sign-in whose provider-verified
    email matches an existing unverified account links into it, marks it
    verified, and must also restore the saved preferences — not just the
    verify-email link.
    """
    password = random_lower_string()
    user, old_email = _make_verified_user_with_password(db_transaction, password=password)
    user.notify_channel_showtime_ping = NotificationChannel.EMAIL
    user.notify_watchlist_digest_enabled = True
    db_transaction.add(user)
    db_transaction.commit()
    user_id = user.id

    headers = user_authentication_headers(client=client, email=old_email, password=password)
    new_email = random_email()
    r = _patch_me(client, headers, email=new_email, current_password=password)
    assert r.status_code == 200, r.text

    unverified = _get_user(db_transaction, user_id)
    assert unverified.email_verified is False
    assert unverified.unverified_email_saved_channels == ["notify_channel_showtime_ping"]
    assert unverified.unverified_email_saved_digest_enabled is True

    # Google now asserts ownership of the same (still-unverified) new address.
    sub = f"google-{uuid.uuid4()}"
    monkeypatch.setattr(
        "app.api.routes.login.verify_social_token",
        lambda provider, token: SocialClaims(sub=sub, email=new_email),
    )
    social_response = client.post(
        f"{settings.API_V1_STR}/login/social-token",
        json={"provider": "google", "token": "irrelevant"},
    )
    assert social_response.status_code == 200, social_response.text

    restored = _get_user(db_transaction, user_id)
    assert restored.email_verified is True
    assert restored.notify_channel_showtime_ping == NotificationChannel.EMAIL
    assert restored.notify_watchlist_digest_enabled is True
    assert restored.unverified_email_saved_channels is None
    assert restored.unverified_email_saved_digest_enabled is False
