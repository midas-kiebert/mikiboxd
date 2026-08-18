from datetime import datetime
from uuid import UUID

from sqlmodel import SQLModel

from app.core.enums import UserReportReason, UserReportStatus

__all__ = [
    "UserReportCreate",
    "UserReportUpdate",
    "UserReportAdminView",
]


class UserReportCreate(SQLModel):
    reason: UserReportReason
    message: str | None = None
    # Reporting and blocking are one gesture in the client — nobody reports
    # someone they still want to hear from — but two records, so that lifting
    # the block later does not withdraw the report.
    block_user: bool = True


class UserReportUpdate(SQLModel):
    status: UserReportStatus


class UserReportAdminView(SQLModel):
    id: int
    reported_id: UUID
    reported_display_name: str | None
    reported_email: str
    reporter_id: UUID
    reporter_email: str
    reason: UserReportReason
    message: str | None
    status: UserReportStatus
    created_at: datetime
    resolved_at: datetime | None
    report_count: int
