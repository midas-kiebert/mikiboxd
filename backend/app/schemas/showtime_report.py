from datetime import datetime
from uuid import UUID

from sqlmodel import SQLModel

from app.core.enums import ShowtimeReportReason, ShowtimeReportStatus

__all__ = [
    "ShowtimeReportCreate",
    "ShowtimeReportUpdate",
    "ShowtimeReportAdminView",
]


class ShowtimeReportCreate(SQLModel):
    reason: ShowtimeReportReason
    message: str | None = None


class ShowtimeReportUpdate(SQLModel):
    status: ShowtimeReportStatus


class ShowtimeReportAdminView(SQLModel):
    id: int
    showtime_id: int
    movie_id: int
    movie_title: str
    cinema_id: int
    cinema_name: str
    cinema_url: str
    showtime_datetime: datetime
    ticket_link: str | None
    reporter_id: UUID
    reporter_email: str
    reporter_report_banned: bool
    reason: ShowtimeReportReason
    message: str | None
    status: ShowtimeReportStatus
    created_at: datetime
    resolved_at: datetime | None
    report_count: int
