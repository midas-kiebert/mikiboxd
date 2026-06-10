"""Tests for the login + refresh-token auth flow."""

from fastapi.testclient import TestClient

from app.core.config import settings


def _login(client: TestClient) -> dict[str, str]:
    r = client.post(
        f"{settings.API_V1_STR}/login/access-token",
        data={
            "username": settings.FIRST_SUPERUSER,
            "password": settings.FIRST_SUPERUSER_PASSWORD,
        },
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_login_returns_access_and_refresh_tokens(client: TestClient) -> None:
    tokens = _login(client)
    assert tokens["access_token"]
    assert tokens["refresh_token"]
    assert tokens["token_type"] == "bearer"


def test_access_token_authenticates_protected_route(client: TestClient) -> None:
    tokens = _login(client)
    r = client.get(
        f"{settings.API_V1_STR}/me",
        headers={"Authorization": f"Bearer {tokens['access_token']}"},
    )
    assert r.status_code == 200


def test_refresh_returns_new_working_tokens(client: TestClient) -> None:
    tokens = _login(client)
    r = client.post(
        f"{settings.API_V1_STR}/login/refresh-token",
        json={"refresh_token": tokens["refresh_token"]},
    )
    assert r.status_code == 200, r.text
    new_tokens = r.json()
    assert new_tokens["access_token"]
    assert new_tokens["refresh_token"]

    # The freshly minted access token authenticates a protected route.
    me = client.get(
        f"{settings.API_V1_STR}/me",
        headers={"Authorization": f"Bearer {new_tokens['access_token']}"},
    )
    assert me.status_code == 200


def test_access_token_rejected_at_refresh_endpoint(client: TestClient) -> None:
    """An access token is not a refresh token and must be rejected (type claim)."""
    tokens = _login(client)
    r = client.post(
        f"{settings.API_V1_STR}/login/refresh-token",
        json={"refresh_token": tokens["access_token"]},
    )
    assert r.status_code == 401


def test_refresh_token_rejected_as_bearer_credentials(client: TestClient) -> None:
    """A refresh token must not be usable as an access token on protected routes."""
    tokens = _login(client)
    r = client.get(
        f"{settings.API_V1_STR}/me",
        headers={"Authorization": f"Bearer {tokens['refresh_token']}"},
    )
    assert r.status_code == 401


def test_refresh_with_garbage_token_is_unauthorized(client: TestClient) -> None:
    r = client.post(
        f"{settings.API_V1_STR}/login/refresh-token",
        json={"refresh_token": "not-a-real-token"},
    )
    assert r.status_code == 401
