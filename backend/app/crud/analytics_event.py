from datetime import datetime
from uuid import UUID

from sqlalchemy import func
from sqlmodel import Session, col, select

from app.core.enums import AnalyticsEventName
from app.models.analytics_event import AnalyticsEvent


def create_event(
    *,
    session: Session,
    user_id: UUID,
    name: AnalyticsEventName,
    platform: str | None,
    properties: dict | None = None,
) -> AnalyticsEvent:
    event = AnalyticsEvent(
        user_id=user_id,
        name=name,
        platform=platform,
        properties=properties,
    )
    session.add(event)
    session.flush()
    return event


def count_by_name(
    *, session: Session, since: datetime
) -> dict[AnalyticsEventName, int]:
    stmt = (
        select(AnalyticsEvent.name, func.count())
        .where(col(AnalyticsEvent.created_at) >= since)
        .group_by(AnalyticsEvent.name)
    )
    return dict(session.exec(stmt).all())


def count_logins_by_day_and_platform(
    *, session: Session, since: datetime
) -> list[tuple[datetime, str | None, int]]:
    day = func.date_trunc("day", AnalyticsEvent.created_at)
    stmt = (
        select(day, AnalyticsEvent.platform, func.count())
        .where(
            AnalyticsEvent.name == AnalyticsEventName.LOGIN,
            col(AnalyticsEvent.created_at) >= since,
        )
        .group_by(day, AnalyticsEvent.platform)
        .order_by(day)
    )
    return list(session.exec(stmt).all())
