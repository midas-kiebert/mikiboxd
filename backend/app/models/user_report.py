"""User report — one user flagging another for moderation.

The sibling of `ShowtimeReport`: same shape, same admin triage states, but the
subject is a person rather than a screening. Kept as its own table because the
two queues are read by different questions ("is this screening real?" versus
"is this account abusive?") and sharing one table would mean every query on
either had to remember to filter by which kind it was.

Reporting someone does not block them — the client offers both in one step, but
they are separate records so that lifting a block never withdraws a report.
"""

import datetime as dt
from uuid import UUID

from sqlalchemy import Column
from sqlalchemy import Enum as SAEnum
from sqlmodel import Field, SQLModel

from app.core.enums import UserReportReason, UserReportStatus
from app.utils import now_amsterdam_naive


def _enum_column(enum_cls: type, *, index: bool = False) -> Column:
    return Column(
        SAEnum(
            enum_cls,
            native_enum=False,
            values_callable=lambda enum: [member.value for member in enum],
        ),
        nullable=False,
        index=index,
    )


class UserReport(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    reporter_id: UUID = Field(
        foreign_key="user.id",
        nullable=False,
        ondelete="CASCADE",
        index=True,
    )
    reported_id: UUID = Field(
        foreign_key="user.id",
        nullable=False,
        ondelete="CASCADE",
        index=True,
    )
    reason: UserReportReason = Field(sa_column=_enum_column(UserReportReason))
    message: str | None = Field(default=None, max_length=1000)
    status: UserReportStatus = Field(
        default=UserReportStatus.OPEN,
        sa_column=_enum_column(UserReportStatus, index=True),
    )
    created_at: dt.datetime = Field(default_factory=now_amsterdam_naive, nullable=False)
    resolved_at: dt.datetime | None = Field(default=None, nullable=True)
