from datetime import datetime
from uuid import UUID

from sqlalchemy import func
from sqlmodel import Session, col, select

from app.core.enums import AnalyticsEventName
from app.models.analytics_event import AnalyticsEvent
from app.models.user import User


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
        select(col(AnalyticsEvent.name), func.count())
        .where(col(AnalyticsEvent.created_at) >= since)
        .group_by(AnalyticsEvent.name)
    )
    return dict(session.exec(stmt).all())


def count_opens_by_day_and_user(
    *, session: Session, since: datetime
) -> list[tuple[datetime, UUID, str, str | None, int]]:
    """One row per (day, user, platform) with how many times they opened the app/site.

    Counts both LOGIN (credential sign-in) and APP_OPEN (silent re-auth on an
    already-authenticated launch) so the dashboard reflects actual usage, not
    just the rarer event of typing in a password. Kept per-user rather than
    aggregated across all users so the dashboard can show who is actually
    using the product, not just a daily total.
    """
    day = func.date_trunc("day", AnalyticsEvent.created_at)
    stmt = (
        select(  # type: ignore[call-overload]
            day,
            AnalyticsEvent.user_id,
            User.email,
            AnalyticsEvent.platform,
            func.count(),
        )
        .join(User, User.id == AnalyticsEvent.user_id)
        .where(
            col(AnalyticsEvent.name).in_(
                [AnalyticsEventName.LOGIN, AnalyticsEventName.APP_OPEN]
            ),
            col(AnalyticsEvent.created_at) >= since,
        )
        .group_by(day, AnalyticsEvent.user_id, User.email, AnalyticsEvent.platform)
        .order_by(day.desc(), User.email)
    )
    return list(session.exec(stmt).all())
