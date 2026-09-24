"""`GET /me/away-events`: what happened while the app was closed.

Feeds the app's notification tips, which may only speak about events since the
app was last in use — so the window boundary is the thing under test.
"""

from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.core.enums import GoingStatus
from app.models.friendship import FriendRequest
from app.models.showtime_ping import ShowtimePing
from app.models.showtime_selection import ShowtimeSelection
from app.models.user import User
from app.utils import now_amsterdam_naive


def _me(session: Session) -> User:
    return session.exec(select(User).where(User.email == settings.EMAIL_TEST_USER)).one()


def _get(client: TestClient, headers: dict[str, str], since: datetime) -> dict:
    r = client.get(
        f"{settings.API_V1_STR}/me/away-events",
        headers=headers,
        params={"since": since.isoformat()},
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_counts_only_events_after_the_window_start(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
    showtime_factory,
) -> None:
    me = _me(db_transaction)
    friend = user_factory()
    other = user_factory()
    showtime = showtime_factory()
    now = now_amsterdam_naive()
    db_transaction.add(
        ShowtimePing(
            showtime_id=showtime.id,
            sender_id=friend.id,
            receiver_id=me.id,
            created_at=now - timedelta(hours=3),
        )
    )
    db_transaction.add(
        FriendRequest(sender_id=other.id, receiver_id=me.id, created_at=now)
    )
    db_transaction.commit()

    before_both = _get(
        client, normal_user_token_headers, datetime.now(UTC) - timedelta(hours=5)
    )
    assert len(before_both["upcoming_invites"]) == 1
    assert before_both["friend_requests"] == 1

    between = _get(
        client, normal_user_token_headers, datetime.now(UTC) - timedelta(hours=1)
    )
    assert between["upcoming_invites"] == []
    assert between["friend_requests"] == 1


def test_splits_invites_into_upcoming_and_missed(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
    showtime_factory,
) -> None:
    me = _me(db_transaction)
    friend = user_factory()
    now = now_amsterdam_naive()
    upcoming = showtime_factory()
    upcoming.datetime = now + timedelta(days=1)
    missed = showtime_factory()
    missed.datetime = now - timedelta(hours=1)
    # Started too, but the invite was looked at before it did: not missed.
    seen_in_time = showtime_factory()
    seen_in_time.datetime = now - timedelta(hours=1)
    for showtime, seen_at in (
        (upcoming, None),
        (missed, None),
        (seen_in_time, now - timedelta(hours=2)),
    ):
        db_transaction.add(showtime)
        db_transaction.add(
            ShowtimePing(
                showtime_id=showtime.id,
                sender_id=friend.id,
                receiver_id=me.id,
                created_at=now - timedelta(hours=3),
                seen_at=seen_at,
            )
        )
    db_transaction.commit()

    events = _get(
        client, normal_user_token_headers, datetime.now(UTC) - timedelta(hours=5)
    )

    assert [i["screening"]["showtime_id"] for i in events["upcoming_invites"]] == [
        upcoming.id
    ]
    assert [i["screening"]["showtime_id"] for i in events["missed_invites"]] == [
        missed.id
    ]
    assert events["upcoming_invites"][0]["sender_name"] == friend.display_name


def test_lists_interested_screenings_that_sold_out_in_the_window(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    showtime_factory,
) -> None:
    me = _me(db_transaction)
    upcoming = showtime_factory()
    upcoming.datetime = now_amsterdam_naive() + timedelta(days=2)
    past = showtime_factory()
    past.datetime = now_amsterdam_naive() - timedelta(days=1)
    for showtime in (upcoming, past):
        db_transaction.add(showtime)
        db_transaction.add(
            ShowtimeSelection(
                user_id=me.id,
                showtime_id=showtime.id,
                going_status=GoingStatus.INTERESTED,
                sold_out_alert_sent_at=now_amsterdam_naive(),
            )
        )
    db_transaction.commit()

    events = _get(
        client, normal_user_token_headers, datetime.now(UTC) - timedelta(hours=1)
    )

    assert [row["showtime_id"] for row in events["sold_out"]] == [upcoming.id]
