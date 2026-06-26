from datetime import datetime

from sqlmodel import SQLModel

from app.core.enums import AnalyticsEventName

__all__ = ["AnalyticsEventCreate", "AnalyticsEventPublic"]


class AnalyticsEventCreate(SQLModel):
    name: AnalyticsEventName
    properties: dict | None = None


class AnalyticsEventPublic(SQLModel):
    id: int
    name: AnalyticsEventName
    platform: str | None
    properties: dict | None
    created_at: datetime
