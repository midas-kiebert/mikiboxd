from datetime import timedelta

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.core.enums import GoingStatus
from app.crud import friendship as friendship_crud
from app.models.cinema_selection import CinemaSelection
from app.models.friend_group import FriendGroup, FriendGroupMember
from app.models.friendship import FriendRequest, Friendship
from app.models.push_token import PushToken
from app.models.showtime_ping import ShowtimePing
from app.models.showtime_selection import ShowtimeSelection
from app.models.user import User
from app.utils import now_amsterdam_naive


def _normal_user_id(db_transaction: Session):
    return db_transaction.exec(
        select(User.id).where(User.email == settings.EMAIL_TEST_USER)
    ).one()


def test_get_me_superuser(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = client.get(f"{settings.API_V1_STR}/me", headers=superuser_token_headers)
    current_user = r.json()
    assert current_user
    assert current_user["is_active"] is True
    assert current_user["is_superuser"] is True
    assert current_user["email"] == settings.FIRST_SUPERUSER
    assert isinstance(current_user["incognito_mode"], bool)
    assert isinstance(current_user["notify_on_friend_showtime_match"], bool)
    assert isinstance(current_user["notify_on_friend_requests"], bool)
    assert isinstance(current_user["notify_on_showtime_ping"], bool)
    assert isinstance(current_user["notify_on_interest_reminder"], bool)
    assert current_user["notify_channel_friend_showtime_match"] in {"push", "email"}
    assert current_user["notify_channel_friend_requests"] in {"push", "email"}
    assert current_user["notify_channel_showtime_ping"] in {"push", "email"}
    assert current_user["notify_channel_interest_reminder"] in {"push", "email"}
    assert "letterboxd_username" in current_user
    assert "last_watchlist_sync" not in current_user


def test_get_me_normal_user(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    r = client.get(f"{settings.API_V1_STR}/me", headers=normal_user_token_headers)
    current_user = r.json()
    assert current_user
    assert current_user["is_active"] is True
    assert current_user["is_superuser"] is False
    assert current_user["email"] == settings.EMAIL_TEST_USER
    assert isinstance(current_user["incognito_mode"], bool)
    assert isinstance(current_user["notify_on_friend_showtime_match"], bool)
    assert isinstance(current_user["notify_on_friend_requests"], bool)
    assert isinstance(current_user["notify_on_showtime_ping"], bool)
    assert isinstance(current_user["notify_on_interest_reminder"], bool)
    assert current_user["notify_channel_friend_showtime_match"] in {"push", "email"}
    assert current_user["notify_channel_friend_requests"] in {"push", "email"}
    assert current_user["notify_channel_showtime_ping"] in {"push", "email"}
    assert current_user["notify_channel_interest_reminder"] in {"push", "email"}
    assert "letterboxd_username" in current_user
    assert "last_watchlist_sync" not in current_user


def test_delete_me_removes_user_and_related_rows(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
    showtime_factory,
) -> None:
    current_user_id = _normal_user_id(db_transaction)
    other_user = user_factory()
    showtime = showtime_factory()

    db_transaction.add(
        ShowtimeSelection(
            user_id=current_user_id,
            showtime_id=showtime.id,
        )
    )
    db_transaction.add(
        CinemaSelection(
            user_id=current_user_id,
            cinema_id=showtime.cinema_id,
        )
    )
    db_transaction.add(
        Friendship(
            user_id=current_user_id,
            friend_id=other_user.id,
        )
    )
    db_transaction.add(
        Friendship(
            user_id=other_user.id,
            friend_id=current_user_id,
        )
    )
    db_transaction.add(
        FriendRequest(
            sender_id=current_user_id,
            receiver_id=other_user.id,
        )
    )
    db_transaction.add(
        FriendRequest(
            sender_id=other_user.id,
            receiver_id=current_user_id,
        )
    )
    db_transaction.add(
        PushToken(
            token=f"delete-me-token-{current_user_id}",
            user_id=current_user_id,
            platform="ios",
        )
    )
    friend_group = FriendGroup(
        owner_user_id=current_user_id,
        name="Close friends",
        is_favorite=True,
        created_at=now_amsterdam_naive(),
        updated_at=now_amsterdam_naive(),
    )
    db_transaction.add(friend_group)
    db_transaction.flush()
    friend_group_id = friend_group.id
    db_transaction.add(
        FriendGroupMember(
            group_id=friend_group_id,
            friend_id=other_user.id,
            created_at=now_amsterdam_naive(),
        )
    )
    db_transaction.add(
        ShowtimePing(
            showtime_id=showtime.id,
            sender_id=current_user_id,
            receiver_id=other_user.id,
            created_at=now_amsterdam_naive(),
        )
    )
    db_transaction.add(
        ShowtimePing(
            showtime_id=showtime.id,
            sender_id=other_user.id,
            receiver_id=current_user_id,
            created_at=now_amsterdam_naive(),
        )
    )
    db_transaction.commit()

    delete_response = client.delete(
        f"{settings.API_V1_STR}/me/",
        headers=normal_user_token_headers,
    )
    assert delete_response.status_code == 200
    assert delete_response.json()["message"] == "User deleted successfully"

    deleted_user = db_transaction.exec(
        select(User).where(User.id == current_user_id)
    ).one_or_none()
    assert deleted_user is None
    assert (
        db_transaction.exec(
            select(ShowtimeSelection).where(
                ShowtimeSelection.user_id == current_user_id
            )
        ).one_or_none()
        is None
    )
    assert (
        db_transaction.exec(
            select(CinemaSelection).where(CinemaSelection.user_id == current_user_id)
        ).one_or_none()
        is None
    )
    assert (
        db_transaction.exec(
            select(PushToken).where(PushToken.user_id == current_user_id)
        ).one_or_none()
        is None
    )
    assert (
        db_transaction.exec(
            select(FriendGroup).where(FriendGroup.owner_user_id == current_user_id)
        ).one_or_none()
        is None
    )
    assert (
        db_transaction.exec(
            select(FriendGroupMember).where(
                FriendGroupMember.group_id == friend_group_id
            )
        ).one_or_none()
        is None
    )
    assert (
        db_transaction.exec(
            select(Friendship).where(
                (Friendship.user_id == current_user_id)
                | (Friendship.friend_id == current_user_id)
            )
        ).one_or_none()
        is None
    )
    assert (
        db_transaction.exec(
            select(FriendRequest).where(
                (FriendRequest.sender_id == current_user_id)
                | (FriendRequest.receiver_id == current_user_id)
            )
        ).one_or_none()
        is None
    )
    assert (
        db_transaction.exec(
            select(ShowtimePing).where(
                (ShowtimePing.sender_id == current_user_id)
                | (ShowtimePing.receiver_id == current_user_id)
            )
        ).one_or_none()
        is None
    )


def test_delete_push_token_for_current_user(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
) -> None:
    current_user_id = _normal_user_id(db_transaction)
    test_token = f"delete-token-{current_user_id}"
    db_transaction.add(
        PushToken(token=test_token, user_id=current_user_id, platform="android")
    )
    db_transaction.commit()

    response = client.request(
        "DELETE",
        f"{settings.API_V1_STR}/me/push-tokens",
        headers={
            **normal_user_token_headers,
            "Content-Type": "application/json",
        },
        json={"token": test_token},
    )
    assert response.status_code == 200
    assert response.json()["message"] == "Push token deleted successfully"

    assert (
        db_transaction.exec(
            select(PushToken).where(PushToken.token == test_token)
        ).one_or_none()
        is None
    )


def test_delete_me_rejects_superuser(
    client: TestClient,
    superuser_token_headers: dict[str, str],
) -> None:
    delete_response = client.delete(
        f"{settings.API_V1_STR}/me/",
        headers=superuser_token_headers,
    )
    assert delete_response.status_code == 403
    assert (
        delete_response.json()["detail"]
        == "Super users are not allowed to delete themselves"
    )


def test_update_me_notification_preference(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    update_response = client.patch(
        f"{settings.API_V1_STR}/me/",
        headers=normal_user_token_headers,
        json={
            "notify_on_friend_showtime_match": False,
            "notify_on_friend_requests": False,
            "notify_on_showtime_ping": False,
            "notify_on_interest_reminder": False,
            "notify_channel_friend_showtime_match": "email",
            "notify_channel_friend_requests": "email",
            "notify_channel_showtime_ping": "email",
            "notify_channel_interest_reminder": "email",
        },
    )
    assert 200 <= update_response.status_code < 300
    assert update_response.json()["notify_on_friend_showtime_match"] is False
    assert update_response.json()["notify_on_friend_requests"] is False
    assert update_response.json()["notify_on_showtime_ping"] is False
    assert update_response.json()["notify_on_interest_reminder"] is False
    assert update_response.json()["notify_channel_friend_showtime_match"] == "email"
    assert update_response.json()["notify_channel_friend_requests"] == "email"
    assert update_response.json()["notify_channel_showtime_ping"] == "email"
    assert update_response.json()["notify_channel_interest_reminder"] == "email"

    me_response = client.get(
        f"{settings.API_V1_STR}/me",
        headers=normal_user_token_headers,
    )
    assert 200 <= me_response.status_code < 300
    assert me_response.json()["notify_on_friend_showtime_match"] is False
    assert me_response.json()["notify_on_friend_requests"] is False
    assert me_response.json()["notify_on_showtime_ping"] is False
    assert me_response.json()["notify_on_interest_reminder"] is False
    assert me_response.json()["notify_channel_friend_showtime_match"] == "email"
    assert me_response.json()["notify_channel_friend_requests"] == "email"
    assert me_response.json()["notify_channel_showtime_ping"] == "email"
    assert me_response.json()["notify_channel_interest_reminder"] == "email"


def test_update_me_incognito_mode(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
) -> None:
    enable_response = client.patch(
        f"{settings.API_V1_STR}/me/",
        headers=normal_user_token_headers,
        json={"incognito_mode": True},
    )
    assert enable_response.status_code == 200
    assert enable_response.json()["incognito_mode"] is True

    get_enabled_response = client.get(
        f"{settings.API_V1_STR}/me",
        headers=normal_user_token_headers,
    )
    assert get_enabled_response.status_code == 200
    assert get_enabled_response.json()["incognito_mode"] is True

    disable_response = client.patch(
        f"{settings.API_V1_STR}/me/",
        headers=normal_user_token_headers,
        json={"incognito_mode": False},
    )
    assert disable_response.status_code == 200
    assert disable_response.json()["incognito_mode"] is False


def test_update_me_rejects_duplicate_display_name(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    user_factory,
) -> None:
    user_factory(display_name="Taken_Name")

    update_response = client.patch(
        f"{settings.API_V1_STR}/me/",
        headers=normal_user_token_headers,
        json={"display_name": "taken_name"},
    )

    assert update_response.status_code == 409
    assert (
        update_response.json()["detail"]
        == "User with username taken_name already exists."
    )


def test_update_me_rejects_invalid_username_characters(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
) -> None:
    update_response = client.patch(
        f"{settings.API_V1_STR}/me/",
        headers=normal_user_token_headers,
        json={"display_name": "not valid"},
    )

    assert update_response.status_code == 400
    assert (
        update_response.json()["detail"]
        == "Username must be 4-15 characters and use only letters, numbers, and underscores."
    )


def test_update_me_rejects_username_under_min_length(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
) -> None:
    update_response = client.patch(
        f"{settings.API_V1_STR}/me/",
        headers=normal_user_token_headers,
        json={"display_name": "abc"},
    )

    assert update_response.status_code == 400
    assert (
        update_response.json()["detail"]
        == "Username must be 4-15 characters and use only letters, numbers, and underscores."
    )


def test_update_me_rejects_username_over_max_length(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
) -> None:
    update_response = client.patch(
        f"{settings.API_V1_STR}/me/",
        headers=normal_user_token_headers,
        json={"display_name": "a" * 16},
    )

    assert update_response.status_code == 400
    assert (
        update_response.json()["detail"]
        == "Username must be 4-15 characters and use only letters, numbers, and underscores."
    )


def test_update_me_allows_unchanged_legacy_username(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
) -> None:
    normal_user = db_transaction.exec(
        select(User).where(User.email == settings.EMAIL_TEST_USER)
    ).one()
    normal_user.display_name = "Legacy Name"
    db_transaction.add(normal_user)
    db_transaction.commit()

    update_response = client.patch(
        f"{settings.API_V1_STR}/me/",
        headers=normal_user_token_headers,
        json={"display_name": "Legacy Name"},
    )

    assert update_response.status_code == 200
    assert update_response.json()["display_name"] == "Legacy Name"


def test_update_me_allows_duplicate_letterboxd_username_and_normalizes_lowercase(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
) -> None:
    existing_user = user_factory()
    existing_letterboxd_username = existing_user.letterboxd_username
    assert existing_letterboxd_username is not None

    mixed_case_username = existing_letterboxd_username.upper()
    update_response = client.patch(
        f"{settings.API_V1_STR}/me/",
        headers=normal_user_token_headers,
        json={"letterboxd_username": mixed_case_username},
    )

    assert update_response.status_code == 200
    assert update_response.json()["letterboxd_username"] == existing_letterboxd_username

    normal_user = db_transaction.exec(
        select(User).where(User.email == settings.EMAIL_TEST_USER)
    ).one()
    assert normal_user.letterboxd_username == existing_letterboxd_username


def test_showtime_pings_endpoints(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
    showtime_factory,
) -> None:
    receiver_id = _normal_user_id(db_transaction)
    sender = user_factory()
    showtime = showtime_factory()
    ping = ShowtimePing(
        showtime_id=showtime.id,
        sender_id=sender.id,
        receiver_id=receiver_id,
        created_at=now_amsterdam_naive(),
    )
    db_transaction.add(ping)
    db_transaction.commit()

    list_response = client.get(
        f"{settings.API_V1_STR}/me/pings",
        headers=normal_user_token_headers,
    )
    assert list_response.status_code == 200
    pings = list_response.json()
    assert len(pings) == 1
    assert pings[0]["showtime_id"] == showtime.id
    assert pings[0]["movie_id"] == showtime.movie_id
    assert pings[0]["showtime"]["id"] == showtime.id
    assert pings[0]["showtime"]["movie"]["id"] == showtime.movie_id
    assert pings[0]["sender"]["id"] == str(sender.id)
    assert pings[0]["seen_at"] is None
    # The nested showtime carries invite info for the receiver.
    assert [u["id"] for u in pings[0]["showtime"]["invited_by"]] == [str(sender.id)]
    assert pings[0]["showtime"]["invite_ping_ids"] == [ping.id]

    unseen_count_response = client.get(
        f"{settings.API_V1_STR}/me/pings/unseen-count",
        headers=normal_user_token_headers,
    )
    assert unseen_count_response.status_code == 200
    assert unseen_count_response.json() == 1

    mark_seen_response = client.post(
        f"{settings.API_V1_STR}/me/pings/mark-seen",
        headers=normal_user_token_headers,
    )
    assert mark_seen_response.status_code == 200

    unseen_count_after_mark_response = client.get(
        f"{settings.API_V1_STR}/me/pings/unseen-count",
        headers=normal_user_token_headers,
    )
    assert unseen_count_after_mark_response.status_code == 200
    assert unseen_count_after_mark_response.json() == 0


def test_get_my_agenda(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
    showtime_factory,
) -> None:
    receiver_id = _normal_user_id(db_transaction)
    sender = user_factory()

    going_showtime = showtime_factory()
    interested_showtime = showtime_factory()
    invited_showtime = showtime_factory()
    unrelated_showtime = showtime_factory()
    sender_id = sender.id
    going_id = going_showtime.id
    interested_id = interested_showtime.id
    invited_id = invited_showtime.id
    unrelated_id = unrelated_showtime.id

    db_transaction.add(
        ShowtimeSelection(
            showtime_id=going_id,
            user_id=receiver_id,
            going_status=GoingStatus.GOING,
        )
    )
    db_transaction.add(
        ShowtimeSelection(
            showtime_id=interested_id,
            user_id=receiver_id,
            going_status=GoingStatus.INTERESTED,
        )
    )
    db_transaction.add(
        ShowtimePing(
            showtime_id=invited_id,
            sender_id=sender_id,
            receiver_id=receiver_id,
            created_at=now_amsterdam_naive(),
        )
    )
    db_transaction.commit()

    response = client.get(
        f"{settings.API_V1_STR}/me/agenda",
        headers=normal_user_token_headers,
    )
    assert response.status_code == 200
    agenda = response.json()
    by_id = {item["id"]: item for item in agenda}

    assert going_id in by_id
    assert interested_id in by_id
    assert invited_id in by_id
    assert unrelated_id not in by_id

    assert by_id[going_id]["going"] == "GOING"
    assert by_id[interested_id]["going"] == "INTERESTED"

    invited_item = by_id[invited_id]
    assert invited_item["going"] == "NOT_GOING"
    assert [u["id"] for u in invited_item["invited_by"]] == [str(sender_id)]
    assert len(invited_item["invite_ping_ids"]) == 1

    # Showtimes ordered by datetime ascending.
    datetimes = [item["datetime"] for item in agenda]
    assert datetimes == sorted(datetimes)


def test_get_my_agenda_toggles(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
    showtime_factory,
) -> None:
    receiver_id = _normal_user_id(db_transaction)
    sender = user_factory()

    going_showtime = showtime_factory()
    interested_showtime = showtime_factory()
    invited_showtime = showtime_factory()
    going_id = going_showtime.id
    interested_id = interested_showtime.id
    invited_id = invited_showtime.id

    db_transaction.add(
        ShowtimeSelection(
            showtime_id=going_id,
            user_id=receiver_id,
            going_status=GoingStatus.GOING,
        )
    )
    db_transaction.add(
        ShowtimeSelection(
            showtime_id=interested_id,
            user_id=receiver_id,
            going_status=GoingStatus.INTERESTED,
        )
    )
    db_transaction.add(
        ShowtimePing(
            showtime_id=invited_id,
            sender_id=sender.id,
            receiver_id=receiver_id,
            created_at=now_amsterdam_naive(),
        )
    )
    db_transaction.commit()

    # Hide interested → going + invited remain.
    response = client.get(
        f"{settings.API_V1_STR}/me/agenda",
        headers=normal_user_token_headers,
        params={"include_interested": False},
    )
    ids = {item["id"] for item in response.json()}
    assert going_id in ids
    assert invited_id in ids
    assert interested_id not in ids

    # Hide invites → going + interested remain.
    response = client.get(
        f"{settings.API_V1_STR}/me/agenda",
        headers=normal_user_token_headers,
        params={"include_invited": False},
    )
    ids = {item["id"] for item in response.json()}
    assert going_id in ids
    assert interested_id in ids
    assert invited_id not in ids

    # Hide both → only going remains.
    response = client.get(
        f"{settings.API_V1_STR}/me/agenda",
        headers=normal_user_token_headers,
        params={"include_interested": False, "include_invited": False},
    )
    ids = {item["id"] for item in response.json()}
    assert ids == {going_id}


def test_get_my_agenda_excludes_past_and_dismissed(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
    showtime_factory,
) -> None:
    receiver_id = _normal_user_id(db_transaction)
    sender = user_factory()

    past_showtime = showtime_factory(datetime=now_amsterdam_naive() - timedelta(days=2))
    dismissed_invite_showtime = showtime_factory()
    past_id = past_showtime.id
    dismissed_id = dismissed_invite_showtime.id

    db_transaction.add(
        ShowtimeSelection(
            showtime_id=past_id,
            user_id=receiver_id,
            going_status=GoingStatus.GOING,
        )
    )
    db_transaction.add(
        ShowtimePing(
            showtime_id=dismissed_id,
            sender_id=sender.id,
            receiver_id=receiver_id,
            created_at=now_amsterdam_naive(),
            dismissed_at=now_amsterdam_naive(),
        )
    )
    db_transaction.commit()

    response = client.get(
        f"{settings.API_V1_STR}/me/agenda",
        headers=normal_user_token_headers,
    )
    assert response.status_code == 200
    ids = {item["id"] for item in response.json()}
    assert past_id not in ids
    assert dismissed_id not in ids


def test_delete_showtime_ping_endpoint(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
    showtime_factory,
) -> None:
    receiver_id = _normal_user_id(db_transaction)
    sender = user_factory()
    other_receiver = user_factory()
    showtime = showtime_factory()

    ping_for_me = ShowtimePing(
        showtime_id=showtime.id,
        sender_id=sender.id,
        receiver_id=receiver_id,
        created_at=now_amsterdam_naive(),
    )
    ping_for_other_user = ShowtimePing(
        showtime_id=showtime.id,
        sender_id=sender.id,
        receiver_id=other_receiver.id,
        created_at=now_amsterdam_naive(),
    )
    db_transaction.add(ping_for_me)
    db_transaction.add(ping_for_other_user)
    db_transaction.commit()

    assert ping_for_me.id is not None
    assert ping_for_other_user.id is not None
    ping_for_me_id = ping_for_me.id
    ping_for_other_user_id = ping_for_other_user.id

    delete_response = client.delete(
        f"{settings.API_V1_STR}/me/pings/{ping_for_me_id}",
        headers=normal_user_token_headers,
    )
    assert delete_response.status_code == 200
    assert delete_response.json()["message"] == "Showtime invite deleted successfully"

    deleted_ping = db_transaction.exec(
        select(ShowtimePing).where(ShowtimePing.id == ping_for_me_id)
    ).one_or_none()
    assert deleted_ping is None

    still_existing_ping = db_transaction.exec(
        select(ShowtimePing).where(ShowtimePing.id == ping_for_other_user_id)
    ).one_or_none()
    assert still_existing_ping is not None

    delete_missing_response = client.delete(
        f"{settings.API_V1_STR}/me/pings/{ping_for_other_user_id}",
        headers=normal_user_token_headers,
    )
    assert delete_missing_response.status_code == 404
    assert delete_missing_response.json()["detail"] == "Showtime invite not found"


def test_me_pings_prune_past_showtimes_and_return_only_future(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
    showtime_factory,
) -> None:
    receiver_id = _normal_user_id(db_transaction)
    sender = user_factory()
    now = now_amsterdam_naive()
    past_showtime = showtime_factory(datetime=now - timedelta(hours=3))
    future_showtime = showtime_factory(datetime=now + timedelta(days=1))

    past_ping = ShowtimePing(
        showtime_id=past_showtime.id,
        sender_id=sender.id,
        receiver_id=receiver_id,
        created_at=now,
    )
    future_ping = ShowtimePing(
        showtime_id=future_showtime.id,
        sender_id=sender.id,
        receiver_id=receiver_id,
        created_at=now,
    )
    db_transaction.add(past_ping)
    db_transaction.add(future_ping)
    db_transaction.commit()

    assert past_ping.id is not None
    assert future_ping.id is not None
    past_ping_id = past_ping.id
    future_ping_id = future_ping.id

    list_response = client.get(
        f"{settings.API_V1_STR}/me/pings",
        headers=normal_user_token_headers,
    )
    assert list_response.status_code == 200
    response_body = list_response.json()
    assert len(response_body) == 1
    assert response_body[0]["showtime_id"] == future_showtime.id

    past_ping_in_db = db_transaction.exec(
        select(ShowtimePing).where(ShowtimePing.id == past_ping_id)
    ).one_or_none()
    assert past_ping_in_db is None

    future_ping_in_db = db_transaction.exec(
        select(ShowtimePing).where(ShowtimePing.id == future_ping_id)
    ).one_or_none()
    assert future_ping_in_db is not None

    unseen_count_response = client.get(
        f"{settings.API_V1_STR}/me/pings/unseen-count",
        headers=normal_user_token_headers,
    )
    assert unseen_count_response.status_code == 200
    assert unseen_count_response.json() == 1


def test_me_pings_sorting_is_done_in_backend(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
    showtime_factory,
) -> None:
    receiver_id = _normal_user_id(db_transaction)
    sender = user_factory()
    now = now_amsterdam_naive()
    later_showtime = showtime_factory(datetime=now + timedelta(days=3))
    earlier_showtime = showtime_factory(datetime=now + timedelta(days=1))

    # Newer ping on earlier showtime: default sort should place this first.
    newer_ping = ShowtimePing(
        showtime_id=earlier_showtime.id,
        sender_id=sender.id,
        receiver_id=receiver_id,
        created_at=now,
    )
    older_ping = ShowtimePing(
        showtime_id=later_showtime.id,
        sender_id=sender.id,
        receiver_id=receiver_id,
        created_at=now - timedelta(hours=2),
    )
    db_transaction.add(newer_ping)
    db_transaction.add(older_ping)
    db_transaction.commit()

    default_sorted_response = client.get(
        f"{settings.API_V1_STR}/me/pings",
        headers=normal_user_token_headers,
    )
    assert default_sorted_response.status_code == 200
    default_showtime_ids = [
        item["showtime_id"] for item in default_sorted_response.json()
    ]
    assert default_showtime_ids == [earlier_showtime.id, later_showtime.id]

    showtime_sorted_response = client.get(
        f"{settings.API_V1_STR}/me/pings",
        headers=normal_user_token_headers,
        params={"sort_by": "showtime_datetime"},
    )
    assert showtime_sorted_response.status_code == 200
    showtime_sorted_ids = [
        item["showtime_id"] for item in showtime_sorted_response.json()
    ]
    assert showtime_sorted_ids == [later_showtime.id, earlier_showtime.id]


_LIST_ID_A = "11111111-1111-1111-1111-111111111111"
_LIST_ID_B = "22222222-2222-2222-2222-222222222222"


def test_saved_presets_store_untouched_fields_lists_and_cinemas(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    # A preset that leaves "days" and one list as-is, controls everything else,
    # and pins a cinema selection.
    payload = {
        "name": "Weekend at the Local",
        "untouched_fields": ["days", f"list:{_LIST_ID_B}"],
        "filters": {
            "selected_showtime_filter": "going",
            "watchlist_only": True,
            "watchlist_exclude": False,
            "hide_watched": True,
            "watched_only": False,
            "selected_list_ids": [_LIST_ID_A],
            "exclude_list_ids": [_LIST_ID_B],
            "days": ["2026-02-21", "2026-02-22"],
            "time_ranges": ["18:00-21:59"],
        },
        "cinema_ids": [3, 1, 1, 2],
    }
    create = client.post(
        f"{settings.API_V1_STR}/me/saved-presets",
        headers=normal_user_token_headers,
        json=payload,
    )
    assert create.status_code == 200
    body = create.json()
    assert body["untouched_fields"] == ["days", f"list:{_LIST_ID_B}"]
    # cinema_ids are normalized (deduped + sorted).
    assert body["cinema_ids"] == [1, 2, 3]
    # The full filter snapshot is preserved, including the new movie-set fields.
    assert body["filters"]["days"] == ["2026-02-21", "2026-02-22"]
    assert body["filters"]["selected_showtime_filter"] == "going"
    assert body["filters"]["hide_watched"] is True
    assert body["filters"]["selected_list_ids"] == [_LIST_ID_A]
    assert body["filters"]["exclude_list_ids"] == [_LIST_ID_B]
    assert body["is_favorite"] is False

    # Listing returns no synthetic "Default" preset.
    presets_list = client.get(
        f"{settings.API_V1_STR}/me/saved-presets",
        headers=normal_user_token_headers,
    )
    assert presets_list.status_code == 200
    presets = presets_list.json()
    assert [preset["name"] for preset in presets] == ["Weekend at the Local"]


def test_saved_preset_defaults_untouched_fields_and_keeps_cinema_ids(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    # Omitting untouched_fields means "control every dimension".
    payload = {
        "name": "Just Status",
        "filters": {"selected_showtime_filter": "interested"},
        "cinema_ids": [2, 1],
    }
    create = client.post(
        f"{settings.API_V1_STR}/me/saved-presets",
        headers=normal_user_token_headers,
        json=payload,
    )
    assert create.status_code == 200
    body = create.json()
    assert body["untouched_fields"] == []
    # Cinemas are opt-in: a carried selection is stored (normalized).
    assert body["cinema_ids"] == [1, 2]


def test_saved_preset_omitting_cinema_ids_leaves_them_null(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    payload = {
        "name": "No Cinemas",
        "untouched_fields": ["selected_showtime_filter"],
        "filters": {"selected_showtime_filter": "interested"},
    }
    create = client.post(
        f"{settings.API_V1_STR}/me/saved-presets",
        headers=normal_user_token_headers,
        json=payload,
    )
    assert create.status_code == 200
    assert create.json()["cinema_ids"] is None


def test_saved_preset_validation_errors(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    base = {
        "name": "Bad",
        "filters": {},
    }

    # Empty untouched_fields is valid (control everything).
    empty = client.post(
        f"{settings.API_V1_STR}/me/saved-presets",
        headers=normal_user_token_headers,
        json={**base, "untouched_fields": []},
    )
    assert empty.status_code == 200

    # A well-formed list token is accepted.
    list_token = client.post(
        f"{settings.API_V1_STR}/me/saved-presets",
        headers=normal_user_token_headers,
        json={**base, "name": "List", "untouched_fields": [f"list:{_LIST_ID_A}"]},
    )
    assert list_token.status_code == 200

    # Unknown token is rejected.
    unknown = client.post(
        f"{settings.API_V1_STR}/me/saved-presets",
        headers=normal_user_token_headers,
        json={**base, "untouched_fields": ["not_a_real_field"]},
    )
    assert unknown.status_code == 422

    # "cinemas" is not an opt-out token (cinemas are opt-in via cinema_ids).
    cinemas_token = client.post(
        f"{settings.API_V1_STR}/me/saved-presets",
        headers=normal_user_token_headers,
        json={**base, "untouched_fields": ["cinemas"]},
    )
    assert cinemas_token.status_code == 422

    # Malformed list token (non-uuid suffix) is rejected.
    bad_list = client.post(
        f"{settings.API_V1_STR}/me/saved-presets",
        headers=normal_user_token_headers,
        json={**base, "untouched_fields": ["list:not-a-uuid"]},
    )
    assert bad_list.status_code == 422


def test_saved_preset_upsert_delete_and_favorite(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    first = client.post(
        f"{settings.API_V1_STR}/me/saved-presets",
        headers=normal_user_token_headers,
        json={
            "name": "Quick",
            "untouched_fields": ["time_ranges"],
            "filters": {"time_ranges": ["18:00-21:59"]},
        },
    )
    assert first.status_code == 200
    first_id = first.json()["id"]

    # Same name upserts the existing row.
    upsert = client.post(
        f"{settings.API_V1_STR}/me/saved-presets",
        headers=normal_user_token_headers,
        json={
            "name": "Quick",
            "untouched_fields": ["days"],
            "filters": {"days": ["2026-03-01"]},
        },
    )
    assert upsert.status_code == 200
    assert upsert.json()["id"] == first_id
    assert upsert.json()["untouched_fields"] == ["days"]

    second = client.post(
        f"{settings.API_V1_STR}/me/saved-presets",
        headers=normal_user_token_headers,
        json={
            "name": "Late",
            "untouched_fields": ["time_ranges"],
            "filters": {"time_ranges": ["22:00-"]},
            "is_favorite": True,
        },
    )
    assert second.status_code == 200
    second_id = second.json()["id"]
    assert second.json()["is_favorite"] is True

    favorite_get = client.get(
        f"{settings.API_V1_STR}/me/saved-presets/favorite",
        headers=normal_user_token_headers,
    )
    assert favorite_get.status_code == 200
    assert favorite_get.json()["id"] == second_id

    # Favoriting another preset clears the previous favorite.
    refavorite = client.put(
        f"{settings.API_V1_STR}/me/saved-presets/{first_id}/favorite",
        headers=normal_user_token_headers,
    )
    assert refavorite.status_code == 200
    favorite_after = client.get(
        f"{settings.API_V1_STR}/me/saved-presets/favorite",
        headers=normal_user_token_headers,
    )
    assert favorite_after.json()["id"] == first_id

    delete = client.delete(
        f"{settings.API_V1_STR}/me/saved-presets/{first_id}",
        headers=normal_user_token_headers,
    )
    assert delete.status_code == 200

    missing_delete = client.delete(
        f"{settings.API_V1_STR}/me/saved-presets/{first_id}",
        headers=normal_user_token_headers,
    )
    assert missing_delete.status_code == 404


def test_cinema_presets_and_favorite_cinema_selection(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    default_preset_id = "00000000-0000-0000-0000-000000000003"
    weekday_payload = {
        "name": "Weekday Run",
        "cinema_ids": [1, 2, 3],
    }
    weekend_payload = {
        "name": "Weekend Run",
        "cinema_ids": [4, 5],
    }

    weekday_create = client.post(
        f"{settings.API_V1_STR}/me/cinema-presets",
        headers=normal_user_token_headers,
        json=weekday_payload,
    )
    assert weekday_create.status_code == 200
    weekday_body = weekday_create.json()
    weekday_id = weekday_body["id"]
    assert weekday_body["is_favorite"] is False

    weekend_create = client.post(
        f"{settings.API_V1_STR}/me/cinema-presets",
        headers=normal_user_token_headers,
        json=weekend_payload,
    )
    assert weekend_create.status_code == 200
    weekend_id = weekend_create.json()["id"]

    set_favorite = client.put(
        f"{settings.API_V1_STR}/me/cinema-presets/{weekend_id}/favorite",
        headers=normal_user_token_headers,
    )
    assert set_favorite.status_code == 200
    assert set_favorite.json()["is_favorite"] is True

    favorite_preset = client.get(
        f"{settings.API_V1_STR}/me/cinema-presets/favorite",
        headers=normal_user_token_headers,
    )
    assert favorite_preset.status_code == 200
    assert favorite_preset.json()["id"] == weekend_id
    assert favorite_preset.json()["cinema_ids"] == [4, 5]

    legacy_selected = client.get(
        f"{settings.API_V1_STR}/me/cinemas",
        headers=normal_user_token_headers,
    )
    assert legacy_selected.status_code == 200
    assert legacy_selected.json() == [4, 5]

    list_response = client.get(
        f"{settings.API_V1_STR}/me/cinema-presets",
        headers=normal_user_token_headers,
    )
    assert list_response.status_code == 200
    by_id = {preset["id"]: preset for preset in list_response.json()}
    assert default_preset_id in by_id
    assert by_id[default_preset_id]["name"] == "All Cinemas"
    assert by_id[default_preset_id]["is_default"] is True
    assert by_id[weekday_id]["is_favorite"] is False
    assert by_id[weekend_id]["is_favorite"] is True

    legacy_set = client.post(
        f"{settings.API_V1_STR}/me/cinemas",
        headers=normal_user_token_headers,
        json=[2, 6],
    )
    assert legacy_set.status_code == 200

    favorite_after_legacy_set = client.get(
        f"{settings.API_V1_STR}/me/cinema-presets/favorite",
        headers=normal_user_token_headers,
    )
    assert favorite_after_legacy_set.status_code == 200
    assert favorite_after_legacy_set.json()["cinema_ids"] == [2, 6]

    delete_response = client.delete(
        f"{settings.API_V1_STR}/me/cinema-presets/{weekend_id}",
        headers=normal_user_token_headers,
    )
    assert delete_response.status_code == 200

    delete_default_response = client.delete(
        f"{settings.API_V1_STR}/me/cinema-presets/{default_preset_id}",
        headers=normal_user_token_headers,
    )
    assert delete_default_response.status_code == 404


def test_legacy_preferred_cinemas_still_work_on_me_cinemas(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    cinema_factory,
) -> None:
    first_cinema = cinema_factory()
    second_cinema = cinema_factory()
    first_cinema_id = first_cinema.id
    second_cinema_id = second_cinema.id

    user_id = db_transaction.exec(
        select(User.id).where(User.email == settings.EMAIL_TEST_USER)
    ).one()

    db_transaction.add(
        CinemaSelection(
            user_id=user_id,
            cinema_id=first_cinema_id,
        )
    )
    db_transaction.add(
        CinemaSelection(
            user_id=user_id,
            cinema_id=second_cinema_id,
        )
    )
    db_transaction.commit()

    legacy_get = client.get(
        f"{settings.API_V1_STR}/me/cinemas",
        headers=normal_user_token_headers,
    )
    assert legacy_get.status_code == 200
    assert sorted(legacy_get.json()) == sorted([first_cinema_id, second_cinema_id])

    set_favorite = client.post(
        f"{settings.API_V1_STR}/me/cinemas",
        headers=normal_user_token_headers,
        json=[first_cinema_id],
    )
    assert set_favorite.status_code == 200

    favorite_get = client.get(
        f"{settings.API_V1_STR}/me/cinemas",
        headers=normal_user_token_headers,
    )
    assert favorite_get.status_code == 200
    assert favorite_get.json() == [first_cinema_id]


def test_friend_groups_crud_and_default_visibility_selection(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
) -> None:
    current_user_id = _normal_user_id(db_transaction)
    first_friend = user_factory()
    second_friend = user_factory()
    first_friend_id = first_friend.id
    second_friend_id = second_friend.id

    friendship_crud.create_friendship(
        session=db_transaction,
        user_id=current_user_id,
        friend_id=first_friend_id,
    )
    friendship_crud.create_friendship(
        session=db_transaction,
        user_id=current_user_id,
        friend_id=second_friend_id,
    )
    db_transaction.commit()

    create_response = client.post(
        f"{settings.API_V1_STR}/me/friend-groups",
        headers=normal_user_token_headers,
        json={
            "name": "Core Crew",
            "friend_ids": [str(first_friend_id)],
        },
    )
    assert create_response.status_code == 200
    create_body = create_response.json()
    group_id = create_body["id"]
    assert create_body["name"] == "Core Crew"
    assert create_body["friend_ids"] == [str(first_friend_id)]
    assert create_body["is_favorite"] is False

    list_response = client.get(
        f"{settings.API_V1_STR}/me/friend-groups",
        headers=normal_user_token_headers,
    )
    assert list_response.status_code == 200
    listed_groups = list_response.json()
    assert len(listed_groups) == 1
    assert listed_groups[0]["id"] == group_id
    assert listed_groups[0]["friend_ids"] == [str(first_friend_id)]

    favorite_before_set = client.get(
        f"{settings.API_V1_STR}/me/friend-groups/favorite",
        headers=normal_user_token_headers,
    )
    assert favorite_before_set.status_code == 200
    assert favorite_before_set.json() is None

    set_favorite_response = client.put(
        f"{settings.API_V1_STR}/me/friend-groups/{group_id}/favorite",
        headers=normal_user_token_headers,
    )
    assert set_favorite_response.status_code == 200
    assert set_favorite_response.json()["is_favorite"] is True

    favorite_after_set = client.get(
        f"{settings.API_V1_STR}/me/friend-groups/favorite",
        headers=normal_user_token_headers,
    )
    assert favorite_after_set.status_code == 200
    assert favorite_after_set.json()["id"] == group_id

    upsert_response = client.post(
        f"{settings.API_V1_STR}/me/friend-groups",
        headers=normal_user_token_headers,
        json={
            "name": "Core Crew",
            "friend_ids": [str(first_friend_id), str(second_friend_id)],
        },
    )
    assert upsert_response.status_code == 200
    upsert_body = upsert_response.json()
    assert upsert_body["id"] == group_id
    assert sorted(upsert_body["friend_ids"]) == sorted(
        [str(first_friend_id), str(second_friend_id)]
    )

    clear_favorite_response = client.delete(
        f"{settings.API_V1_STR}/me/friend-groups/favorite",
        headers=normal_user_token_headers,
    )
    assert clear_favorite_response.status_code == 200

    favorite_after_clear = client.get(
        f"{settings.API_V1_STR}/me/friend-groups/favorite",
        headers=normal_user_token_headers,
    )
    assert favorite_after_clear.status_code == 200
    assert favorite_after_clear.json() is None

    delete_response = client.delete(
        f"{settings.API_V1_STR}/me/friend-groups/{group_id}",
        headers=normal_user_token_headers,
    )
    assert delete_response.status_code == 200
    assert delete_response.json()["message"] == "Friend group deleted successfully"

    list_after_delete = client.get(
        f"{settings.API_V1_STR}/me/friend-groups",
        headers=normal_user_token_headers,
    )
    assert list_after_delete.status_code == 200
    assert list_after_delete.json() == []


def test_friend_group_rejects_non_friend_member(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    user_factory,
) -> None:
    non_friend = user_factory()

    create_response = client.post(
        f"{settings.API_V1_STR}/me/friend-groups",
        headers=normal_user_token_headers,
        json={
            "name": "Invalid Group",
            "friend_ids": [str(non_friend.id)],
        },
    )
    assert create_response.status_code == 400
    assert (
        create_response.json()["detail"]
        == "Friend group contains users who are not your friends."
    )


def test_friend_group_rejects_empty_member_set(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
) -> None:
    create_response = client.post(
        f"{settings.API_V1_STR}/me/friend-groups",
        headers=normal_user_token_headers,
        json={
            "name": "Empty Group",
            "friend_ids": [],
        },
    )
    assert create_response.status_code == 400
    assert (
        create_response.json()["detail"]
        == "Friend group must contain at least one friend."
    )


def test_friend_group_rejects_duplicate_member_set(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
) -> None:
    current_user_id = _normal_user_id(db_transaction)
    first_friend = user_factory()
    second_friend = user_factory()
    first_friend_id = first_friend.id
    second_friend_id = second_friend.id

    friendship_crud.create_friendship(
        session=db_transaction,
        user_id=current_user_id,
        friend_id=first_friend_id,
    )
    friendship_crud.create_friendship(
        session=db_transaction,
        user_id=current_user_id,
        friend_id=second_friend_id,
    )
    db_transaction.commit()

    first_group_response = client.post(
        f"{settings.API_V1_STR}/me/friend-groups",
        headers=normal_user_token_headers,
        json={
            "name": "Core Crew",
            "friend_ids": [str(first_friend_id), str(second_friend_id)],
        },
    )
    assert first_group_response.status_code == 200

    duplicate_group_response = client.post(
        f"{settings.API_V1_STR}/me/friend-groups",
        headers=normal_user_token_headers,
        json={
            "name": "Same People Different Name",
            "friend_ids": [str(second_friend_id), str(first_friend_id)],
        },
    )
    assert duplicate_group_response.status_code == 400
    assert (
        duplicate_group_response.json()["detail"]
        == "A friend group with the same members already exists."
    )


def test_unfriending_removes_users_from_both_friend_groups(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
) -> None:
    current_user_id = _normal_user_id(db_transaction)
    friend_user = user_factory()
    friend_id = friend_user.id
    friend_email = friend_user.email

    friendship_crud.create_friendship(
        session=db_transaction,
        user_id=current_user_id,
        friend_id=friend_id,
    )
    db_transaction.commit()

    own_group_response = client.post(
        f"{settings.API_V1_STR}/me/friend-groups",
        headers=normal_user_token_headers,
        json={
            "name": "My Group",
            "friend_ids": [str(friend_id)],
        },
    )
    assert own_group_response.status_code == 200

    friend_login_response = client.post(
        f"{settings.API_V1_STR}/login/access-token",
        data={"username": friend_email, "password": "password"},
    )
    assert friend_login_response.status_code == 200
    friend_headers = {
        "Authorization": f"Bearer {friend_login_response.json()['access_token']}"
    }

    friend_group_response = client.post(
        f"{settings.API_V1_STR}/me/friend-groups",
        headers=friend_headers,
        json={
            "name": "Friend Group",
            "friend_ids": [str(current_user_id)],
        },
    )
    assert friend_group_response.status_code == 200

    remove_friend_response = client.delete(
        f"{settings.API_V1_STR}/friends/{friend_id}",
        headers=normal_user_token_headers,
    )
    assert remove_friend_response.status_code == 200
    assert remove_friend_response.json()["message"] == "Friend removed successfully."

    own_groups_after_response = client.get(
        f"{settings.API_V1_STR}/me/friend-groups",
        headers=normal_user_token_headers,
    )
    assert own_groups_after_response.status_code == 200
    assert own_groups_after_response.json() == []

    friend_groups_after_response = client.get(
        f"{settings.API_V1_STR}/me/friend-groups",
        headers=friend_headers,
    )
    assert friend_groups_after_response.status_code == 200
    assert friend_groups_after_response.json() == []


def test_friend_group_shrinkage_deletes_group_that_coincides_with_existing_group(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
) -> None:
    current_user_id = _normal_user_id(db_transaction)
    first_friend = user_factory()
    second_friend = user_factory()
    first_friend_id = first_friend.id
    second_friend_id = second_friend.id

    friendship_crud.create_friendship(
        session=db_transaction,
        user_id=current_user_id,
        friend_id=first_friend_id,
    )
    friendship_crud.create_friendship(
        session=db_transaction,
        user_id=current_user_id,
        friend_id=second_friend_id,
    )
    db_transaction.commit()

    stable_group_response = client.post(
        f"{settings.API_V1_STR}/me/friend-groups",
        headers=normal_user_token_headers,
        json={
            "name": "Only First Friend",
            "friend_ids": [str(first_friend_id)],
        },
    )
    assert stable_group_response.status_code == 200
    stable_group_id = stable_group_response.json()["id"]

    shrinking_group_response = client.post(
        f"{settings.API_V1_STR}/me/friend-groups",
        headers=normal_user_token_headers,
        json={
            "name": "Both Friends",
            "friend_ids": [str(first_friend_id), str(second_friend_id)],
        },
    )
    assert shrinking_group_response.status_code == 200

    remove_friend_response = client.delete(
        f"{settings.API_V1_STR}/friends/{second_friend_id}",
        headers=normal_user_token_headers,
    )
    assert remove_friend_response.status_code == 200

    groups_after_response = client.get(
        f"{settings.API_V1_STR}/me/friend-groups",
        headers=normal_user_token_headers,
    )
    assert groups_after_response.status_code == 200
    groups_after = groups_after_response.json()
    assert len(groups_after) == 1
    assert groups_after[0]["id"] == stable_group_id
    assert groups_after[0]["friend_ids"] == [str(first_friend_id)]
