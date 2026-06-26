"""Showtime report — a user flagging a showtime as wrong or non-existent."""

import datetime as dt
from uuid import UUID

from sqlalchemy import Column
from sqlalchemy import Enum as SAEnum
from sqlmodel import Field, SQLModel

from app.core.enums import ShowtimeReportReason, ShowtimeReportStatus
from app.utils import now_amsterdam_naive


def _enum_column(enum_cls: type) -> Column:
    return Column(
        SAEnum(
            enum_cls,
            native_enum=False,
            values_callable=lambda enum: [member.value for member in enum],
        ),
        nullable=False,
    )


class ShowtimeReport(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    showtime_id: int = Field(
        foreign_key="showtime.id",
        nullable=False,
        ondelete="CASCADE",
        index=True,
    )
    reporter_id: UUID = Field(
        foreign_key="user.id",
        nullable=False,
        ondelete="CASCADE",
        index=True,
    )
    reason: ShowtimeReportReason = Field(sa_column=_enum_column(ShowtimeReportReason))
    message: str | None = Field(default=None, max_length=1000)
    status: ShowtimeReportStatus = Field(
        default=ShowtimeReportStatus.OPEN,
        sa_column=Column(
            SAEnum(
                ShowtimeReportStatus,
                native_enum=False,
                values_callable=lambda enum: [member.value for member in enum],
            ),
            nullable=False,
            index=True,
        ),
    )
    created_at: dt.datetime = Field(default_factory=now_amsterdam_naive, nullable=False)
    resolved_at: dt.datetime | None = Field(default=None, nullable=True)
