from fastapi.testclient import TestClient

from app.core.config import settings


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
    assert "letterboxd_username" in current_user
    assert "last_watchlist_sync" not in current_user


def test_update_me_notification_preference(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    update_response = client.patch(
        f"{settings.API_V1_STR}/me/",
        headers=normal_user_token_headers,
        json={"notify_on_friend_showtime_match": True},
    )
    assert 200 <= update_response.status_code < 300
    assert update_response.json()["notify_on_friend_showtime_match"] is True

    me_response = client.get(
        f"{settings.API_V1_STR}/me",
        headers=normal_user_token_headers,
    )
    assert 200 <= me_response.status_code < 300
    assert me_response.json()["notify_on_friend_showtime_match"] is True


def test_filter_presets_are_scoped_and_include_all_pill_filters(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    showtimes_payload = {
        "name": "After Work",
        "scope": "SHOWTIMES",
        "filters": {
            "selected_showtime_filter": "interested",
            "watchlist_only": True,
            "selected_cinema_ids": [1, 2, 3],
            "days": ["2026-02-21", "2026-02-22"],
            "time_ranges": ["18:00-21:59", "22:00-"],
        },
    }
    movies_payload = {
        "name": "Weekend Movies",
        "scope": "MOVIES",
        "filters": {
            "watchlist_only": False,
            "selected_cinema_ids": [4, 5],
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
    assert len(showtimes_presets) == 1
    assert showtimes_presets[0]["name"] == "After Work"
    assert showtimes_presets[0]["scope"] == "SHOWTIMES"
    assert showtimes_presets[0]["filters"]["selected_showtime_filter"] == "interested"
    assert showtimes_presets[0]["filters"]["watchlist_only"] is True
    assert showtimes_presets[0]["filters"]["selected_cinema_ids"] == [1, 2, 3]
    assert showtimes_presets[0]["filters"]["days"] == ["2026-02-21", "2026-02-22"]
    assert showtimes_presets[0]["filters"]["time_ranges"] == ["18:00-21:59", "22:00-"]

    movies_list = client.get(
        f"{settings.API_V1_STR}/me/filter-presets",
        headers=normal_user_token_headers,
        params={"scope": "MOVIES"},
    )
    assert movies_list.status_code == 200
    movies_presets = movies_list.json()
    assert len(movies_presets) == 1
    assert movies_presets[0]["name"] == "Weekend Movies"
    assert movies_presets[0]["scope"] == "MOVIES"
    assert movies_presets[0]["filters"]["watchlist_only"] is False
    assert movies_presets[0]["filters"]["selected_cinema_ids"] == [4, 5]
    assert movies_presets[0]["filters"]["days"] == ["2026-02-23"]
    assert movies_presets[0]["filters"]["time_ranges"] == ["10:00-14:00"]
    assert movies_presets[0]["filters"]["selected_showtime_filter"] is None


def test_filter_preset_upsert_and_delete(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    payload_initial = {
        "name": "Quick Pick",
        "scope": "SHOWTIMES",
        "filters": {
            "selected_showtime_filter": "going",
            "watchlist_only": False,
            "selected_cinema_ids": [7],
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
            "selected_cinema_ids": [8, 9],
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
    assert second_body["filters"]["watchlist_only"] is True
    assert second_body["filters"]["selected_cinema_ids"] == [8, 9]
    assert second_body["filters"]["days"] == ["2026-02-26", "2026-02-27"]
    assert second_body["filters"]["time_ranges"] == ["-04:00", "20:00-"]

    list_response = client.get(
        f"{settings.API_V1_STR}/me/filter-presets",
        headers=normal_user_token_headers,
        params={"scope": "SHOWTIMES"},
    )
    assert list_response.status_code == 200
    body = list_response.json()
    assert len(body) == 1
    assert body[0]["id"] == first_id

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
    assert list_after_delete.json() == []
