"""`GET /me/activity/summary`: the Activity screen's numbers, over the whole list.

The point of the endpoint is that its counts agree with the list the clients
page through (`/showtimes` for All/Friends, `/me/agenda` for You), so several
tests read both and compare.
"""

from datetime import datetime, timedelta

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.core.enums import GoingStatus
from app.crud import friendship as friendship_crud
from app.crud import showtime as showtime_crud
from app.models.showtime_ping import ShowtimePing
from app.models.user import User
from app.utils import now_amsterdam_naive

SUMMARY_URL = f"{settings.API_V1_STR}/me/activity/summary"
ACTIVITY_STATUSES = [GoingStatus.GOING.value, GoingStatus.INTERESTED.value]


def _normal_user_id(db_transaction: Session):
    return db_transaction.exec(
        select(User.id).where(User.email == settings.EMAIL_TEST_USER)
    ).one()


def _evening(days_ahead: int, hour: int = 20) -> datetime:
    base = now_amsterdam_naive() + timedelta(days=days_ahead)
    return base.replace(hour=hour, minute=0, second=0, microsecond=0)


def _select(session: Session, *, showtime_id: int, user_id, status: GoingStatus) -> None:
    showtime_crud.add_showtime_selection(
        session=session,
        showtime_id=showtime_id,
        user_id=user_id,
        going_status=status,
    )


def _setup_activity(db_transaction: Session, user_factory, showtime_factory):
    """Me going to one, a friend going to one and interested in another,
    a stranger going to one more, and one nobody cares about."""
    me = _normal_user_id(db_transaction)
    friend = user_factory()
    stranger = user_factory()
    mine = showtime_factory(datetime=_evening(2))
    friend_going = showtime_factory(datetime=_evening(3))
    friend_interested = showtime_factory(datetime=_evening(3, hour=22))
    strangers = showtime_factory(datetime=_evening(4))
    showtime_factory(datetime=_evening(5))
    ids = {
        "me": me,
        "friend": friend.id,
        "mine": mine.id,
        "friend_going": friend_going.id,
        "friend_interested": friend_interested.id,
        "stranger": stranger.id,
        "strangers": strangers.id,
    }

    friendship_crud.create_friendship(
        session=db_transaction, user_id=me, friend_id=ids["friend"]
    )
    _select(db_transaction, showtime_id=ids["mine"], user_id=me, status=GoingStatus.GOING)
    _select(
        db_transaction,
        showtime_id=ids["friend_going"],
        user_id=ids["friend"],
        status=GoingStatus.GOING,
    )
    _select(
        db_transaction,
        showtime_id=ids["friend_interested"],
        user_id=ids["friend"],
        status=GoingStatus.INTERESTED,
    )
    _select(
        db_transaction,
        showtime_id=ids["strangers"],
        user_id=ids["stranger"],
        status=GoingStatus.GOING,
    )
    db_transaction.commit()
    return ids


def _list_ids(client: TestClient, headers, *, friends_only: bool) -> list[int]:
    response = client.get(
        f"{settings.API_V1_STR}/showtimes",
        headers=headers,
        params={
            "limit": 200,
            "offset": 0,
            "selected_statuses": ACTIVITY_STATUSES,
            "all_cinemas": True,
            "friends_only": friends_only,
        },
    )
    assert response.status_code == 200
    return [item["id"] for item in response.json()]


def test_activity_summary_requires_an_account(client: TestClient) -> None:
    assert client.get(SUMMARY_URL).status_code == 401


def test_activity_summary_all_counts_the_whole_list(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
    showtime_factory,
) -> None:
    ids = _setup_activity(db_transaction, user_factory, showtime_factory)

    response = client.get(SUMMARY_URL, headers=normal_user_token_headers, params={"mode": "all"})
    assert response.status_code == 200
    body = response.json()

    listed = _list_ids(client, normal_user_token_headers, friends_only=False)
    assert set(listed) == {ids["mine"], ids["friend_going"], ids["friend_interested"]}
    assert body["total"] == len(listed)
    assert sum(day["count"] for day in body["days"]) == len(listed)
    # Both of the friend's screenings are on the same evening.
    assert {day["day"]: day["count"] for day in body["days"]} == {
        _evening(2).date().isoformat(): 1,
        _evening(3).date().isoformat(): 2,
    }

    assert body["next_plan"]["id"] == ids["mine"]
    assert body["plan_count"] == 1
    assert body["invite_count"] == 0
    assert body["friends"] == [
        {
            "user": body["friends"][0]["user"],
            "going": 1,
            "interested": 1,
        }
    ]
    assert body["friends"][0]["user"]["id"] == str(ids["friend"])


def test_activity_summary_friends_drops_your_own(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
    showtime_factory,
) -> None:
    ids = _setup_activity(db_transaction, user_factory, showtime_factory)

    body = client.get(
        SUMMARY_URL, headers=normal_user_token_headers, params={"mode": "friends"}
    ).json()

    listed = _list_ids(client, normal_user_token_headers, friends_only=True)
    assert set(listed) == {ids["friend_going"], ids["friend_interested"]}
    assert body["total"] == len(listed)
    # Your own plans are not part of the Friends slice.
    assert body["next_plan"] is None
    assert body["plan_count"] == 0
    assert [tally["user"]["id"] for tally in body["friends"]] == [str(ids["friend"])]


def test_activity_summary_you_matches_the_agenda(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
    showtime_factory,
) -> None:
    ids = _setup_activity(db_transaction, user_factory, showtime_factory)
    sender_id = user_factory().id
    invited_id = showtime_factory(datetime=_evening(6)).id
    db_transaction.add(
        ShowtimePing(
            showtime_id=invited_id,
            sender_id=sender_id,
            receiver_id=ids["me"],
            created_at=now_amsterdam_naive(),
        )
    )
    db_transaction.commit()

    body = client.get(SUMMARY_URL, headers=normal_user_token_headers, params={"mode": "you"}).json()
    agenda = client.get(
        f"{settings.API_V1_STR}/me/agenda",
        headers=normal_user_token_headers,
        params={"limit": 200},
    ).json()

    assert {item["id"] for item in agenda} == {ids["mine"], invited_id}
    assert body["total"] == len(agenda)
    assert body["plan_count"] == 1
    assert body["invite_count"] == 1
    assert [invite["id"] for invite in body["invites"]] == [invited_id]
    # No friend ranking on your own agenda.
    assert body["friends"] == []


def test_activity_summary_small_hours_count_towards_the_evening_before(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    showtime_factory,
) -> None:
    me = _normal_user_id(db_transaction)
    evening = _evening(3)
    late_id = showtime_factory(datetime=evening + timedelta(hours=6)).id  # 02:00 next day
    _select(db_transaction, showtime_id=late_id, user_id=me, status=GoingStatus.GOING)
    db_transaction.commit()

    body = client.get(SUMMARY_URL, headers=normal_user_token_headers, params={"mode": "you"}).json()

    assert body["days"] == [{"day": evening.date().isoformat(), "count": 1}]


def test_activity_summary_honours_the_snapshot(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    showtime_factory,
) -> None:
    me = _normal_user_id(db_transaction)
    soon_id = showtime_factory(datetime=_evening(2)).id
    later_id = showtime_factory(datetime=_evening(4)).id
    _select(db_transaction, showtime_id=soon_id, user_id=me, status=GoingStatus.GOING)
    _select(db_transaction, showtime_id=later_id, user_id=me, status=GoingStatus.GOING)
    db_transaction.commit()

    # A snapshot between the two leaves only the later one on the list.
    snapshot = _evening(3).isoformat()
    body = client.get(
        SUMMARY_URL,
        headers=normal_user_token_headers,
        params={"mode": "you", "snapshot_time": snapshot},
    ).json()

    assert body["total"] == 1
    assert body["plan_count"] == 1
    assert body["next_plan"]["id"] == later_id
