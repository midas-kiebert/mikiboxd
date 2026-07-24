import uuid
from datetime import timedelta

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.core.enums import ShowtimeReportReason, ShowtimeReportStatus
from app.crud import showtime_report as showtime_report_crud
from app.models.analytics_event import AnalyticsEvent
from app.models.user import User
from app.utils import now_amsterdam_naive


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
    assert "opens_by_day_user" in payload
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


def test_superuser_can_ban_user_from_reporting_indefinitely(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
) -> None:
    user = user_factory()
    user_id = user.id
    db_transaction.commit()

    response = client.patch(
        f"{settings.API_V1_STR}/admin/users/{user_id}/report-ban",
        headers=superuser_token_headers,
        json={"banned": True, "duration_days": None},
    )
    assert response.status_code == 200

    db_transaction.expire_all()
    banned_user = db_transaction.get(User, user_id)
    assert banned_user is not None
    assert banned_user.report_banned is True
    assert banned_user.report_ban_expires_at is None


def test_superuser_can_ban_user_from_reporting_with_duration(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
) -> None:
    user = user_factory()
    user_id = user.id
    db_transaction.commit()

    response = client.patch(
        f"{settings.API_V1_STR}/admin/users/{user_id}/report-ban",
        headers=superuser_token_headers,
        json={"banned": True, "duration_days": 7},
    )
    assert response.status_code == 200

    db_transaction.expire_all()
    banned_user = db_transaction.get(User, user_id)
    assert banned_user is not None
    assert banned_user.report_banned is True
    assert banned_user.report_ban_expires_at is not None


def test_superuser_can_unban_user_and_clears_both_fields(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
) -> None:
    user = user_factory()
    user.report_banned = True
    user.report_ban_expires_at = now_amsterdam_naive() + timedelta(days=3)
    db_transaction.add(user)
    user_id = user.id
    db_transaction.commit()

    response = client.patch(
        f"{settings.API_V1_STR}/admin/users/{user_id}/report-ban",
        headers=superuser_token_headers,
        json={"banned": False, "duration_days": None},
    )
    assert response.status_code == 200

    db_transaction.expire_all()
    unbanned_user = db_transaction.get(User, user_id)
    assert unbanned_user is not None
    assert unbanned_user.report_banned is False
    assert unbanned_user.report_ban_expires_at is None


def test_report_ban_endpoint_404_for_unknown_user(
    client: TestClient,
    superuser_token_headers: dict[str, str],
) -> None:
    response = client.patch(
        f"{settings.API_V1_STR}/admin/users/{uuid.uuid4()}/report-ban",
        headers=superuser_token_headers,
        json={"banned": True, "duration_days": None},
    )
    assert response.status_code == 404


def test_list_showtime_reports_report_count_reflects_total_per_showtime(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db_transaction: Session,
    showtime_factory,
    user_factory,
) -> None:
    heavily_reported_showtime = showtime_factory()
    lightly_reported_showtime = showtime_factory()
    reporter_one = user_factory()
    reporter_two = user_factory()
    reporter_three = user_factory()

    showtime_report_crud.create_report(
        session=db_transaction,
        showtime_id=heavily_reported_showtime.id,
        reporter_id=reporter_one.id,
        reason=ShowtimeReportReason.INCORRECT_TIME,
        message=None,
    )
    showtime_report_crud.create_report(
        session=db_transaction,
        showtime_id=heavily_reported_showtime.id,
        reporter_id=reporter_two.id,
        reason=ShowtimeReportReason.DOES_NOT_EXIST,
        message=None,
    )
    resolved_report = showtime_report_crud.create_report(
        session=db_transaction,
        showtime_id=heavily_reported_showtime.id,
        reporter_id=reporter_three.id,
        reason=ShowtimeReportReason.DUPLICATE,
        message=None,
    )
    showtime_report_crud.update_status(
        report=resolved_report,
        status=ShowtimeReportStatus.RESOLVED,
        resolved_at=None,
    )
    showtime_report_crud.create_report(
        session=db_transaction,
        showtime_id=lightly_reported_showtime.id,
        reporter_id=reporter_one.id,
        reason=ShowtimeReportReason.OTHER,
        message=None,
    )
    db_transaction.commit()

    response = client.get(
        f"{settings.API_V1_STR}/admin/showtime-reports",
        headers=superuser_token_headers,
    )
    assert response.status_code == 200

    reports_by_showtime: dict[int, list[dict]] = {}
    for report in response.json():
        reports_by_showtime.setdefault(report["showtime_id"], []).append(report)

    heavily_reported = reports_by_showtime[heavily_reported_showtime.id]
    assert len(heavily_reported) == 3
    assert all(report["report_count"] == 3 for report in heavily_reported)

    lightly_reported = reports_by_showtime[lightly_reported_showtime.id]
    assert len(lightly_reported) == 1
    assert lightly_reported[0]["report_count"] == 1


def test_list_showtime_reports_status_filter_keeps_full_report_count(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db_transaction: Session,
    showtime_factory,
    user_factory,
) -> None:
    showtime = showtime_factory()
    reporter_one = user_factory()
    reporter_two = user_factory()

    open_report = showtime_report_crud.create_report(
        session=db_transaction,
        showtime_id=showtime.id,
        reporter_id=reporter_one.id,
        reason=ShowtimeReportReason.INCORRECT_TIME,
        message=None,
    )
    resolved_report = showtime_report_crud.create_report(
        session=db_transaction,
        showtime_id=showtime.id,
        reporter_id=reporter_two.id,
        reason=ShowtimeReportReason.DUPLICATE,
        message=None,
    )
    showtime_report_crud.update_status(
        report=resolved_report,
        status=ShowtimeReportStatus.RESOLVED,
        resolved_at=None,
    )
    db_transaction.commit()
    open_report_id = open_report.id

    response = client.get(
        f"{settings.API_V1_STR}/admin/showtime-reports",
        headers=superuser_token_headers,
        params={"status": "open"},
    )
    assert response.status_code == 200
    body = response.json()
    assert len(body) == 1
    assert body[0]["id"] == open_report_id
    # Even though only the open report is returned, the count reflects both
    # reports on this showtime (any status).
    assert body[0]["report_count"] == 2


def test_list_showtime_reports_exposes_reporter_report_banned_flag(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db_transaction: Session,
    showtime_factory,
    user_factory,
) -> None:
    showtime = showtime_factory()
    banned_reporter = user_factory()
    banned_reporter.report_banned = True
    banned_reporter.report_ban_expires_at = None
    db_transaction.add(banned_reporter)

    showtime_report_crud.create_report(
        session=db_transaction,
        showtime_id=showtime.id,
        reporter_id=banned_reporter.id,
        reason=ShowtimeReportReason.OTHER,
        message=None,
    )
    db_transaction.commit()

    response = client.get(
        f"{settings.API_V1_STR}/admin/showtime-reports",
        headers=superuser_token_headers,
    )
    assert response.status_code == 200
    body = response.json()
    assert len(body) == 1
    assert body[0]["reporter_report_banned"] is True
