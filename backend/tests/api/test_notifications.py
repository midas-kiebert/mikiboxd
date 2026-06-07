from datetime import timedelta

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.core.enums import NotificationType
from app.crud import friendship as friendship_crud
from app.crud import notification as notification_crud
from app.crud import showtime_ping as showtime_ping_crud
from app.models.user import User
from app.utils import now_amsterdam_naive


def _normal_user_id(db_transaction: Session):
    return db_transaction.exec(
        select(User.id).where(User.email == settings.EMAIL_TEST_USER)
    ).one()


def test_feed_merges_all_three_sources_newest_first(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
    showtime_factory,
) -> None:
    current_user_id = _normal_user_id(db_transaction)
    accepter = user_factory()
    inviter = user_factory()
    requester = user_factory()
    showtime = showtime_factory()
    now = now_amsterdam_naive()

    notification_crud.upsert_notification(
        session=db_transaction,
        user_id=current_user_id,
        type=NotificationType.FRIEND_REQUEST_ACCEPTED,
        actor_id=accepter.id,
        showtime_id=None,
        created_at=now,
    )
    showtime_ping_crud.create_showtime_ping(
        session=db_transaction,
        showtime_id=showtime.id,
        sender_id=inviter.id,
        receiver_id=current_user_id,
        created_at=now - timedelta(hours=1),
    )
    request = friendship_crud.create_friend_request(
        session=db_transaction,
        sender_id=requester.id,
        receiver_id=current_user_id,
    )
    request.created_at = now - timedelta(hours=2)
    db_transaction.add(request)
    db_transaction.commit()

    response = client.get(
        f"{settings.API_V1_STR}/me/notifications",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 200
    feed = response.json()
    # Restrict to the entries this test created (the shared test user may carry
    # rows from other tests in the same DB session).
    actor_ids = {str(accepter.id), str(inviter.id), str(requester.id)}
    mine = [item for item in feed if item["actor"]["id"] in actor_ids]
    assert [(item["source"], item["type"]) for item in mine] == [
        ("notification", "friend_request_accepted"),
        ("ping", "showtime_invite"),
        ("friend_request", "friend_request_received"),
    ]
    invite_item = mine[1]
    assert invite_item["showtime"]["id"] == showtime.id
    request_item = mine[2]
    assert request_item["id"] == str(requester.id)
    assert request_item["showtime"] is None


def test_dismiss_notification_removes_it_from_feed(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
    showtime_factory,
) -> None:
    current_user_id = _normal_user_id(db_transaction)
    actor = user_factory()
    showtime = showtime_factory()
    notification = notification_crud.upsert_notification(
        session=db_transaction,
        user_id=current_user_id,
        type=NotificationType.FRIEND_SHOWTIME_MATCH,
        actor_id=actor.id,
        showtime_id=showtime.id,
        created_at=now_amsterdam_naive(),
    )
    db_transaction.commit()

    response = client.delete(
        f"{settings.API_V1_STR}/me/notifications/{notification.id}",
        headers=normal_user_token_headers,
    )
    assert response.status_code == 200

    feed = client.get(
        f"{settings.API_V1_STR}/me/notifications",
        headers=normal_user_token_headers,
    ).json()
    assert all(
        not (item["source"] == "notification" and item["id"] == str(notification.id))
        for item in feed
    )


def test_dismiss_unknown_notification_returns_404(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
) -> None:
    response = client.delete(
        f"{settings.API_V1_STR}/me/notifications/99999999",
        headers=normal_user_token_headers,
    )
    assert response.status_code == 404


def test_unseen_count_counts_both_sources_and_clears_on_mark_seen(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
    showtime_factory,
) -> None:
    current_user_id = _normal_user_id(db_transaction)

    # Zero out any rows other tests may have left for the shared test user.
    client.post(
        f"{settings.API_V1_STR}/me/notifications/mark-seen",
        headers=normal_user_token_headers,
    )

    actor = user_factory()
    inviter = user_factory()
    showtime = showtime_factory()
    now = now_amsterdam_naive()
    notification_crud.upsert_notification(
        session=db_transaction,
        user_id=current_user_id,
        type=NotificationType.FRIEND_SHOWTIME_MATCH,
        actor_id=actor.id,
        showtime_id=showtime.id,
        created_at=now,
    )
    showtime_ping_crud.create_showtime_ping(
        session=db_transaction,
        showtime_id=showtime.id,
        sender_id=inviter.id,
        receiver_id=current_user_id,
        created_at=now,
    )
    db_transaction.commit()

    count = client.get(
        f"{settings.API_V1_STR}/me/notifications/unseen-count",
        headers=normal_user_token_headers,
    ).json()
    assert count == 2

    client.post(
        f"{settings.API_V1_STR}/me/notifications/mark-seen",
        headers=normal_user_token_headers,
    )

    cleared = client.get(
        f"{settings.API_V1_STR}/me/notifications/unseen-count",
        headers=normal_user_token_headers,
    ).json()
    assert cleared == 0
