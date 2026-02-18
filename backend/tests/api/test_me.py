from fastapi.testclient import TestClient

from app.core.config import settings


def test_get_me_superuser(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = client.get(f"{settings.API_V1_STR}/me", headers=superuser_token_headers)
    current_user = r.json()
    assert current_user
    assert current_user["is_active"] is True
    assert "is_superuser" not in current_user
    assert "email" not in current_user
    assert "notify_on_friend_showtime_match" not in current_user
    assert "letterboxd_username" not in current_user
    assert "last_watchlist_sync" not in current_user


def test_get_me_normal_user(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    r = client.get(f"{settings.API_V1_STR}/me", headers=normal_user_token_headers)
    current_user = r.json()
    assert current_user
    assert current_user["is_active"] is True
    assert "is_superuser" not in current_user
    assert "email" not in current_user
    assert "notify_on_friend_showtime_match" not in current_user
    assert "letterboxd_username" not in current_user
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
    assert "notify_on_friend_showtime_match" not in update_response.json()

    me_response = client.get(
        f"{settings.API_V1_STR}/me",
        headers=normal_user_token_headers,
    )
    assert 200 <= me_response.status_code < 300
    assert "notify_on_friend_showtime_match" not in me_response.json()
