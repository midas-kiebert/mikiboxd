from datetime import datetime
from uuid import UUID

from sqlmodel import Session, col, select

from app.core.enums import ShowtimeReportReason, ShowtimeReportStatus
from app.models.cinema import Cinema
from app.models.movie import Movie
from app.models.showtime import Showtime
from app.models.showtime_report import ShowtimeReport
from app.models.user import User


def create_report(
    *,
    session: Session,
    showtime_id: int,
    reporter_id: UUID,
    reason: ShowtimeReportReason,
    message: str | None,
) -> ShowtimeReport:
    report = ShowtimeReport(
        showtime_id=showtime_id,
        reporter_id=reporter_id,
        reason=reason,
        message=message,
    )
    session.add(report)
    session.flush()
    return report


def get_report_by_id(*, session: Session, report_id: int) -> ShowtimeReport | None:
    return session.get(ShowtimeReport, report_id)


def list_reports(
    *, session: Session, status: ShowtimeReportStatus | None
) -> list[tuple[ShowtimeReport, Showtime, Movie, Cinema, User]]:
    stmt = (
        select(ShowtimeReport, Showtime, Movie, Cinema, User)  # type: ignore[call-overload]
        .join(Showtime, Showtime.id == ShowtimeReport.showtime_id)
        .join(Movie, Movie.id == Showtime.movie_id)
        .join(Cinema, Cinema.id == Showtime.cinema_id)
        .join(User, User.id == ShowtimeReport.reporter_id)
        .order_by(col(ShowtimeReport.created_at).desc())
    )
    if status is not None:
        stmt = stmt.where(ShowtimeReport.status == status)
    return list(session.exec(stmt).all())  # type: ignore[return-value]


def update_status(
    *,
    report: ShowtimeReport,
    status: ShowtimeReportStatus,
    resolved_at: datetime | None,
) -> ShowtimeReport:
    report.status = status
    report.resolved_at = resolved_at
    return report
