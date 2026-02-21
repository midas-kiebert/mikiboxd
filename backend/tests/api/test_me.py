from datetime import timedelta

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.models.cinema_selection import CinemaSelection
from app.models.showtime_ping import ShowtimePing
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


def test_update_me_rejects_duplicate_display_name(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    user_factory,
) -> None:
    user_factory(display_name="Taken Name")

    update_response = client.patch(
        f"{settings.API_V1_STR}/me/",
        headers=normal_user_token_headers,
        json={"display_name": "taken name"},
    )

    assert update_response.status_code == 409
    assert update_response.json()["detail"] == "User with display name taken name already exists."


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
    assert pings[0]["sender"]["id"] == str(sender.id)
    assert pings[0]["seen_at"] is None

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
    assert delete_response.json()["message"] == "Showtime ping deleted successfully"

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
    assert delete_missing_response.json()["detail"] == "Showtime ping not found"


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
    default_showtime_ids = [item["showtime_id"] for item in default_sorted_response.json()]
    assert default_showtime_ids == [earlier_showtime.id, later_showtime.id]

    showtime_sorted_response = client.get(
        f"{settings.API_V1_STR}/me/pings",
        headers=normal_user_token_headers,
        params={"sort_by": "showtime_datetime"},
    )
    assert showtime_sorted_response.status_code == 200
    showtime_sorted_ids = [item["showtime_id"] for item in showtime_sorted_response.json()]
    assert showtime_sorted_ids == [later_showtime.id, earlier_showtime.id]


def test_filter_presets_are_scoped_and_include_all_pill_filters(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    showtimes_payload = {
        "name": "After Work",
        "scope": "SHOWTIMES",
        "filters": {
            "selected_showtime_filter": "interested",
            "showtime_audience": "only-you",
            "watchlist_only": True,
            "days": ["2026-02-21", "2026-02-22"],
            "time_ranges": ["18:00-21:59", "22:00-"],
        },
    }
    movies_payload = {
        "name": "Weekend Movies",
        "scope": "MOVIES",
        "filters": {
            "watchlist_only": False,
            "days": ["2026-02-23"],
            "time_ranges": ["10:00-14:00"],
        },
    }

    showtimes_create = client.post(
        f"{settings.API_V1_STR}/me/filter-presets",
        headers=normal_user_token_headers,
        json=showtimes_payload,
    )
    assert showtimes_create.status_code == 200

    movies_create = client.post(
        f"{settings.API_V1_STR}/me/filter-presets",
        headers=normal_user_token_headers,
        json=movies_payload,
    )
    assert movies_create.status_code == 200

    showtimes_list = client.get(
        f"{settings.API_V1_STR}/me/filter-presets",
        headers=normal_user_token_headers,
        params={"scope": "SHOWTIMES"},
    )
    assert showtimes_list.status_code == 200
    showtimes_presets = showtimes_list.json()
    showtimes_default = next(preset for preset in showtimes_presets if preset["is_default"] is True)
    assert showtimes_default["name"] == "Default"
    assert showtimes_default["scope"] == "SHOWTIMES"
    assert showtimes_default["filters"]["selected_showtime_filter"] == "all"
    assert showtimes_default["filters"]["showtime_audience"] == "including-friends"
    assert showtimes_default["filters"]["watchlist_only"] is False
    assert showtimes_default["filters"]["days"] is None
    assert showtimes_default["filters"]["time_ranges"] is None

    showtimes_saved = next(preset for preset in showtimes_presets if preset["name"] == "After Work")
    assert showtimes_saved["scope"] == "SHOWTIMES"
    assert showtimes_saved["filters"]["selected_showtime_filter"] == "interested"
    assert showtimes_saved["filters"]["showtime_audience"] == "only-you"
    assert showtimes_saved["filters"]["watchlist_only"] is True
    assert showtimes_saved["filters"]["days"] == ["2026-02-21", "2026-02-22"]
    assert showtimes_saved["filters"]["time_ranges"] == ["18:00-21:59", "22:00-"]
    assert showtimes_saved["is_favorite"] is False

    movies_list = client.get(
        f"{settings.API_V1_STR}/me/filter-presets",
        headers=normal_user_token_headers,
        params={"scope": "MOVIES"},
    )
    assert movies_list.status_code == 200
    movies_presets = movies_list.json()
    movies_default = next(preset for preset in movies_presets if preset["is_default"] is True)
    assert movies_default["name"] == "Default"
    assert movies_default["scope"] == "MOVIES"
    assert movies_default["filters"]["selected_showtime_filter"] == "all"
    assert movies_default["filters"]["showtime_audience"] == "including-friends"
    assert movies_default["filters"]["watchlist_only"] is False
    assert movies_default["filters"]["days"] is None
    assert movies_default["filters"]["time_ranges"] is None

    movies_saved = next(preset for preset in movies_presets if preset["name"] == "Weekend Movies")
    assert movies_saved["scope"] == "MOVIES"
    assert movies_saved["filters"]["watchlist_only"] is False
    assert movies_saved["filters"]["days"] == ["2026-02-23"]
    assert movies_saved["filters"]["time_ranges"] == ["10:00-14:00"]
    assert movies_saved["filters"]["selected_showtime_filter"] is None
    assert movies_saved["filters"]["showtime_audience"] == "including-friends"
    assert movies_saved["is_favorite"] is False


def test_filter_preset_accepts_relative_and_weekday_days(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    expected_days = [
        "relative:today",
        "relative:tomorrow",
        "relative:day_after_tomorrow",
        "weekday:1",
        "weekday:5",
        "2026-03-01",
    ]
    payload = {
        "name": "Flexible Days",
        "scope": "SHOWTIMES",
        "filters": {
            "selected_showtime_filter": "interested",
            "watchlist_only": True,
            "days": expected_days,
            "time_ranges": ["18:00-21:59"],
        },
    }

    save_response = client.post(
        f"{settings.API_V1_STR}/me/filter-presets",
        headers=normal_user_token_headers,
        json=payload,
    )
    assert save_response.status_code == 200
    save_body = save_response.json()
    assert save_body["filters"]["days"] == expected_days

    list_response = client.get(
        f"{settings.API_V1_STR}/me/filter-presets",
        headers=normal_user_token_headers,
        params={"scope": "SHOWTIMES"},
    )
    assert list_response.status_code == 200
    presets = list_response.json()
    saved = next(preset for preset in presets if preset["name"] == "Flexible Days")
    assert saved["filters"]["days"] == expected_days
    assert saved["filters"]["showtime_audience"] == "including-friends"


def test_filter_preset_upsert_and_delete(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    payload_initial = {
        "name": "Quick Pick",
        "scope": "SHOWTIMES",
        "filters": {
            "selected_showtime_filter": "going",
            "watchlist_only": False,
            "days": ["2026-02-25"],
            "time_ranges": ["12:00-16:00"],
        },
    }
    payload_updated = {
        "name": "Quick Pick",
        "scope": "SHOWTIMES",
        "filters": {
            "selected_showtime_filter": "all",
            "watchlist_only": True,
            "days": ["2026-02-26", "2026-02-27"],
            "time_ranges": ["-04:00", "20:00-"],
        },
    }

    first_save = client.post(
        f"{settings.API_V1_STR}/me/filter-presets",
        headers=normal_user_token_headers,
        json=payload_initial,
    )
    assert first_save.status_code == 200
    first_id = first_save.json()["id"]

    second_save = client.post(
        f"{settings.API_V1_STR}/me/filter-presets",
        headers=normal_user_token_headers,
        json=payload_updated,
    )
    assert second_save.status_code == 200
    second_body = second_save.json()
    assert second_body["id"] == first_id
    assert second_body["filters"]["selected_showtime_filter"] == "all"
    assert second_body["filters"]["showtime_audience"] == "including-friends"
    assert second_body["filters"]["watchlist_only"] is True
    assert second_body["filters"]["days"] == ["2026-02-26", "2026-02-27"]
    assert second_body["filters"]["time_ranges"] == ["-04:00", "20:00-"]

    list_response = client.get(
        f"{settings.API_V1_STR}/me/filter-presets",
        headers=normal_user_token_headers,
        params={"scope": "SHOWTIMES"},
    )
    assert list_response.status_code == 200
    body = list_response.json()
    non_default = [preset for preset in body if not preset["is_default"]]
    assert len(non_default) == 1
    assert non_default[0]["id"] == first_id

    delete_response = client.delete(
        f"{settings.API_V1_STR}/me/filter-presets/{first_id}",
        headers=normal_user_token_headers,
    )
    assert delete_response.status_code == 200

    list_after_delete = client.get(
        f"{settings.API_V1_STR}/me/filter-presets",
        headers=normal_user_token_headers,
        params={"scope": "SHOWTIMES"},
    )
    assert list_after_delete.status_code == 200
    after_delete = list_after_delete.json()
    assert len(after_delete) == 1
    assert after_delete[0]["is_default"] is True
    assert after_delete[0]["name"] == "Default"


def test_filter_preset_can_be_marked_as_favorite(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    first_payload = {
        "name": "Weeknights",
        "scope": "SHOWTIMES",
        "filters": {
            "selected_showtime_filter": "interested",
            "watchlist_only": False,
            "days": ["2026-02-21"],
            "time_ranges": ["18:00-21:59"],
        },
    }
    second_payload = {
        "name": "Late Night",
        "scope": "SHOWTIMES",
        "filters": {
            "selected_showtime_filter": "going",
            "watchlist_only": True,
            "days": ["2026-02-22"],
            "time_ranges": ["22:00-"],
        },
    }

    first_create = client.post(
        f"{settings.API_V1_STR}/me/filter-presets",
        headers=normal_user_token_headers,
        json=first_payload,
    )
    assert first_create.status_code == 200
    first_id = first_create.json()["id"]

    second_create = client.post(
        f"{settings.API_V1_STR}/me/filter-presets",
        headers=normal_user_token_headers,
        json=second_payload,
    )
    assert second_create.status_code == 200
    second_id = second_create.json()["id"]

    favorite_response = client.put(
        f"{settings.API_V1_STR}/me/filter-presets/{second_id}/favorite",
        headers=normal_user_token_headers,
    )
    assert favorite_response.status_code == 200
    assert favorite_response.json()["is_favorite"] is True

    favorite_get = client.get(
        f"{settings.API_V1_STR}/me/filter-presets/favorite",
        headers=normal_user_token_headers,
        params={"scope": "SHOWTIMES"},
    )
    assert favorite_get.status_code == 200
    assert favorite_get.json()["id"] == second_id

    list_response = client.get(
        f"{settings.API_V1_STR}/me/filter-presets",
        headers=normal_user_token_headers,
        params={"scope": "SHOWTIMES"},
    )
    assert list_response.status_code == 200
    by_id = {preset["id"]: preset for preset in list_response.json()}
    assert any(preset["is_default"] is True for preset in list_response.json())
    assert by_id[first_id]["is_favorite"] is False
    assert by_id[second_id]["is_favorite"] is True

    clear_response = client.delete(
        f"{settings.API_V1_STR}/me/filter-presets/favorite",
        headers=normal_user_token_headers,
        params={"scope": "SHOWTIMES"},
    )
    assert clear_response.status_code == 200

    favorite_after_clear = client.get(
        f"{settings.API_V1_STR}/me/filter-presets/favorite",
        headers=normal_user_token_headers,
        params={"scope": "SHOWTIMES"},
    )
    assert favorite_after_clear.status_code == 200
    assert favorite_after_clear.json() is None


def test_cinema_presets_and_favorite_cinema_selection(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
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
