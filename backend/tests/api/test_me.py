from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.models.cinema_selection import CinemaSelection
from app.models.user import User


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
    assert len(showtimes_presets) == 1
    assert showtimes_presets[0]["name"] == "After Work"
    assert showtimes_presets[0]["scope"] == "SHOWTIMES"
    assert showtimes_presets[0]["filters"]["selected_showtime_filter"] == "interested"
    assert showtimes_presets[0]["filters"]["watchlist_only"] is True
    assert showtimes_presets[0]["filters"]["days"] == ["2026-02-21", "2026-02-22"]
    assert showtimes_presets[0]["filters"]["time_ranges"] == ["18:00-21:59", "22:00-"]
    assert showtimes_presets[0]["is_favorite"] is False

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
    assert movies_presets[0]["filters"]["days"] == ["2026-02-23"]
    assert movies_presets[0]["filters"]["time_ranges"] == ["10:00-14:00"]
    assert movies_presets[0]["filters"]["selected_showtime_filter"] is None
    assert movies_presets[0]["is_favorite"] is False


def test_filter_preset_accepts_relative_and_weekday_days(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    payload = {
        "name": "Flexible Days",
        "scope": "SHOWTIMES",
        "filters": {
            "selected_showtime_filter": "interested",
            "watchlist_only": True,
            "days": [
                "relative:today",
                "relative:tomorrow",
                "relative:day_after_tomorrow",
                "weekday:1",
                "weekday:5",
                "2026-03-01",
            ],
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
    assert save_body["filters"]["days"] == payload["filters"]["days"]

    list_response = client.get(
        f"{settings.API_V1_STR}/me/filter-presets",
        headers=normal_user_token_headers,
        params={"scope": "SHOWTIMES"},
    )
    assert list_response.status_code == 200
    presets = list_response.json()
    assert len(presets) == 1
    assert presets[0]["filters"]["days"] == payload["filters"]["days"]


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

    user = db_transaction.exec(
        select(User).where(User.email == settings.EMAIL_TEST_USER)
    ).one()

    db_transaction.add(
        CinemaSelection(
            user_id=user.id,
            cinema_id=first_cinema.id,
        )
    )
    db_transaction.add(
        CinemaSelection(
            user_id=user.id,
            cinema_id=second_cinema.id,
        )
    )
    db_transaction.commit()

    legacy_get = client.get(
        f"{settings.API_V1_STR}/me/cinemas",
        headers=normal_user_token_headers,
    )
    assert legacy_get.status_code == 200
    assert sorted(legacy_get.json()) == sorted([first_cinema.id, second_cinema.id])

    set_favorite = client.post(
        f"{settings.API_V1_STR}/me/cinemas",
        headers=normal_user_token_headers,
        json=[first_cinema.id],
    )
    assert set_favorite.status_code == 200

    favorite_get = client.get(
        f"{settings.API_V1_STR}/me/cinemas",
        headers=normal_user_token_headers,
    )
    assert favorite_get.status_code == 200
    assert favorite_get.json() == [first_cinema.id]
