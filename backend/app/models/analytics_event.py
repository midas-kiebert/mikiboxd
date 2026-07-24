"""Analytics event — a single client/server-fired usage event for the beta.

Deliberately generic (name + free-form properties) rather than one table per
event type, since the set of tracked events is expected to grow during the
beta. See AnalyticsEventName for the closed set of valid names.
"""

import datetime as dt
from uuid import UUID

from sqlalchemy import JSON, Column
from sqlalchemy import Enum as SAEnum
from sqlmodel import Field, SQLModel

from app.core.enums import AnalyticsEventName
from app.utils import now_amsterdam_naive


class AnalyticsEvent(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: UUID = Field(
        foreign_key="user.id",
        nullable=False,
        ondelete="CASCADE",
        index=True,
    )
    name: AnalyticsEventName = Field(
        sa_column=Column(
            SAEnum(
                AnalyticsEventName,
                native_enum=False,
                values_callable=lambda enum: [member.value for member in enum],
            ),
            nullable=False,
            index=True,
        ),
    )
    platform: str | None = Field(default=None, max_length=32)
    properties: dict | None = Field(default=None, sa_column=Column(JSON, nullable=True))
    created_at: dt.datetime = Field(
        default_factory=now_amsterdam_naive, nullable=False, index=True
    )
