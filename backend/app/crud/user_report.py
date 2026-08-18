"""Reads and writes for `UserReport`.

The mirror of `crud/showtime_report.py`, including its scalar-subquery count: a
window function would be computed after the WHERE clause, so filtering the
admin list by status would also shrink the per-user total it reports — see
`reference_sql_window_function_where_gotcha`.
"""

from datetime import datetime
from uuid import UUID

from sqlalchemy.orm import aliased
from sqlmodel import Session, col, func, select

from app.core.enums import UserReportReason, UserReportStatus
from app.models.user import User
from app.models.user_report import UserReport


def create_report(
    *,
    session: Session,
    reporter_id: UUID,
    reported_id: UUID,
    reason: UserReportReason,
    message: str | None,
) -> UserReport:
    report = UserReport(
        reporter_id=reporter_id,
        reported_id=reported_id,
        reason=reason,
        message=message,
    )
    session.add(report)
    session.flush()
    return report


def has_open_report(
    *,
    session: Session,
    reporter_id: UUID,
    reported_id: UUID,
) -> bool:
    """Whether this reporter already has an unresolved report about this user.

    Used to answer a repeat report with the same success the first one got,
    rather than stacking identical rows in the triage queue every time the
    reporter taps again.
    """
    stmt = select(UserReport.id).where(
        col(UserReport.reporter_id) == reporter_id,
        col(UserReport.reported_id) == reported_id,
        col(UserReport.status) == UserReportStatus.OPEN,
    )
    return session.exec(stmt).first() is not None


def count_open_reports_about(*, session: Session, reported_id: UUID) -> int:
    """How many open reports name this user. Included in the operator email."""
    stmt = (
        select(func.count())
        .select_from(UserReport)
        .where(
            col(UserReport.reported_id) == reported_id,
            col(UserReport.status) == UserReportStatus.OPEN,
        )
    )
    return session.exec(stmt).one()


def get_report_by_id(*, session: Session, report_id: int) -> UserReport | None:
    return session.get(UserReport, report_id)


def list_reports(
    *, session: Session, status: UserReportStatus | None
) -> list[tuple[UserReport, User, User, int]]:
    """(report, reported user, reporter, total reports about the reported user)."""
    reported_user = aliased(User)
    reporter_user = aliased(User)
    sibling_report = aliased(UserReport)

    # Correlated on the outer UserReport, so the status filter below narrows
    # which reports are listed without narrowing what the count counts.
    report_count = (
        select(func.count())
        .select_from(sibling_report)
        .where(sibling_report.reported_id == col(UserReport.reported_id))
        .correlate(UserReport)
        .scalar_subquery()
        .label("report_count")
    )
    stmt = (
        select(UserReport, reported_user, reporter_user, report_count)  # type: ignore[call-overload]
        .join(reported_user, col(reported_user.id) == col(UserReport.reported_id))
        .join(reporter_user, col(reporter_user.id) == col(UserReport.reporter_id))
        .order_by(col(UserReport.created_at).desc())
    )
    if status is not None:
        stmt = stmt.where(col(UserReport.status) == status)
    return list(session.exec(stmt).all())  # type: ignore[return-value]


def update_status(
    *,
    report: UserReport,
    status: UserReportStatus,
    resolved_at: datetime | None,
) -> UserReport:
    report.status = status
    report.resolved_at = resolved_at
    return report
