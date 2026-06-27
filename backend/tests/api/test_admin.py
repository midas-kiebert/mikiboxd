from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.models.analytics_event import AnalyticsEvent


def test_non_superuser_is_forbidden_from_admin_routes(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
) -> None:
    response = client.get(
        f"{settings.API_V1_STR}/admin/analytics/overview",
        headers=normal_user_token_headers,
    )
    assert response.status_code == 403


def test_superuser_can_fetch_analytics_overview(
    client: TestClient,
    superuser_token_headers: dict[str, str],
) -> None:
    response = client.get(
        f"{settings.API_V1_STR}/admin/analytics/overview",
        headers=superuser_token_headers,
    )
    assert response.status_code == 200
    payload = response.json()
    assert "logins_by_day_user" in payload
    assert "notification_opt_in" in payload


def test_superuser_can_update_movie_record(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    movie_factory,
) -> None:
    movie = movie_factory()
    response = client.patch(
        f"{settings.API_V1_STR}/admin/movies/{movie.id}",
        headers=superuser_token_headers,
        json={"title": "Corrected Title"},
    )
    assert response.status_code == 200
    assert response.json()["title"] == "Corrected Title"


def test_superuser_can_edit_and_delete_showtime(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    showtime_factory,
    db_transaction: Session,
) -> None:
    showtime = showtime_factory()
    showtime_id = showtime.id

    edit_response = client.patch(
        f"{settings.API_V1_STR}/admin/showtimes/{showtime_id}",
        headers=superuser_token_headers,
        json={"ticket_link": "https://example.com/tickets"},
    )
    assert edit_response.status_code == 200
    assert edit_response.json()["ticket_link"] == "https://example.com/tickets"

    delete_response = client.delete(
        f"{settings.API_V1_STR}/admin/showtimes/{showtime_id}",
        headers=superuser_token_headers,
    )
    assert delete_response.status_code == 200
    assert db_transaction.get(type(showtime), showtime_id) is None


def test_me_events_endpoint_records_event(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/me/events",
        headers=normal_user_token_headers,
        json={"name": "filter_applied", "properties": {"filter": "genre"}},
    )
    assert response.status_code == 204

    events = db_transaction.exec(
        select(AnalyticsEvent).where(AnalyticsEvent.name == "filter_applied")
    ).all()
    assert len(events) == 1
    assert events[0].properties == {"filter": "genre"}


def test_user_can_report_a_showtime(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    showtime_factory,
) -> None:
    showtime = showtime_factory()
    response = client.post(
        f"{settings.API_V1_STR}/showtimes/{showtime.id}/report",
        headers=normal_user_token_headers,
        json={"reason": "incorrect_time", "message": "Starts 30 min later"},
    )
    assert response.status_code == 200

    reports_response = client.get(
        f"{settings.API_V1_STR}/admin/showtime-reports",
        headers={**normal_user_token_headers},
    )
    assert reports_response.status_code == 403
