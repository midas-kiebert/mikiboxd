"""The unsubscribe link in every notification email.

Signed-out, one type at a time, and never on a bare GET: mail scanners open
links on their own, so the page asks for one click before changing anything.
"""

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.core.security import generate_notification_unsubscribe_token
from app.models.user import User

URL = f"{settings.API_V1_STR}/users/unsubscribe-notification"


def _me(session: Session) -> User:
    return session.exec(select(User).where(User.email == settings.EMAIL_TEST_USER)).one()


def test_get_only_asks_for_confirmation(
    client: TestClient,
    db_transaction: Session,
    normal_user_token_headers: dict[str, str],  # creates the test user
) -> None:
    user = _me(db_transaction)
    user.notify_on_showtime_ping = True
    db_transaction.add(user)
    db_transaction.commit()
    token = generate_notification_unsubscribe_token(
        user_id=str(user.id), preference="notify_on_showtime_ping"
    )

    r = client.get(URL, params={"token": token})

    assert r.status_code == 200
    assert "invite emails" in r.text
    db_transaction.expire_all()
    assert _me(db_transaction).notify_on_showtime_ping is True


def test_post_turns_off_exactly_that_notification(
    client: TestClient,
    db_transaction: Session,
    normal_user_token_headers: dict[str, str],  # creates the test user
) -> None:
    user = _me(db_transaction)
    user.notify_on_showtime_ping = True
    user.notify_on_friend_requests = True
    db_transaction.add(user)
    db_transaction.commit()
    token = generate_notification_unsubscribe_token(
        user_id=str(user.id), preference="notify_on_showtime_ping"
    )

    r = client.post(URL, data={"token": token})

    assert r.status_code == 200
    db_transaction.expire_all()
    refreshed = _me(db_transaction)
    assert refreshed.notify_on_showtime_ping is False
    assert refreshed.notify_on_friend_requests is True


def test_seat_emails_unsubscribe_from_all_seat_availability(
    client: TestClient,
    db_transaction: Session,
    normal_user_token_headers: dict[str, str],  # creates the test user
) -> None:
    user = _me(db_transaction)
    user.notify_on_seat_alert = True
    user.notify_on_sold_out = True
    user.notify_on_tickets_available = True
    db_transaction.add(user)
    db_transaction.commit()
    token = generate_notification_unsubscribe_token(
        user_id=str(user.id), preference="notify_on_sold_out"
    )

    client.post(URL, data={"token": token})

    db_transaction.expire_all()
    refreshed = _me(db_transaction)
    assert refreshed.notify_on_seat_alert is False
    assert refreshed.notify_on_sold_out is False
    assert refreshed.notify_on_tickets_available is False


def test_invalid_token_is_refused(client: TestClient) -> None:
    assert client.get(URL, params={"token": "garbage"}).status_code == 400
    assert client.post(URL, data={"token": "garbage"}).status_code == 400
