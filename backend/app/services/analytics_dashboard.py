"""Aggregation for the superuser analytics dashboard.

Some numbers are derived from dedicated AnalyticsEvent rows (logins, filter/
preset usage, invites sent, notification clicks) while others are derived from
existing tables that already capture the behaviour we care about:
  - "invites opened" reuses ShowtimePing.seen_at, set when a ping is read.
  - "notifications sent" reuses Notification.created_at, since a row is
    created per push-eligible event.
  - Notification opt-in rates come straight from the User notify_* columns
    and from whether a user has any registered PushToken.
"""

from datetime import timedelta

from sqlalchemy import func
from sqlmodel import Session, col, select

from app.core.enums import AnalyticsEventName
from app.crud import analytics_event as analytics_event_crud
from app.models.notification import Notification
from app.models.push_token import PushToken
from app.models.showtime_ping import ShowtimePing
from app.models.user import User
from app.schemas.analytics_dashboard import (
    AnalyticsOverview,
    LoginsByDayUser,
    NotificationOptInBreakdown,
)
from app.utils import now_amsterdam_naive

_NOTIFY_SETTINGS = [
    "notify_on_friend_showtime_match",
    "notify_on_friend_requests",
    "notify_on_showtime_ping",
    "notify_on_invite_response",
    "notify_on_interest_reminder",
    "notify_watchlist_digest_enabled",
]


def _count_invites_opened(*, session: Session, since) -> int:
    stmt = select(func.count()).where(
        col(ShowtimePing.created_at) >= since,
        col(ShowtimePing.seen_at).is_not(None),
    )
    return session.exec(stmt).one()


def _count_notifications_sent(*, session: Session, since) -> int:
    stmt = select(func.count()).where(col(Notification.created_at) >= since)
    return session.exec(stmt).one()


def _users_with_push_token(*, session: Session) -> int:
    stmt = select(func.count(func.distinct(PushToken.user_id)))
    return session.exec(stmt).one()


def _notification_opt_in_breakdown(*, session: Session) -> list[NotificationOptInBreakdown]:
    breakdown = []
    for setting in _NOTIFY_SETTINGS:
        column = getattr(User, setting)
        enabled = session.exec(
            select(func.count()).where(column.is_(True))
        ).one()
        disabled = session.exec(
            select(func.count()).where(column.is_(False))
        ).one()
        breakdown.append(
            NotificationOptInBreakdown(
                setting=setting,
                enabled_count=enabled,
                disabled_count=disabled,
            )
        )
    return breakdown


def get_overview(*, session: Session, window_days: int = 30) -> AnalyticsOverview:
    since = now_amsterdam_naive() - timedelta(days=window_days)

    event_counts_raw = analytics_event_crud.count_by_name(session=session, since=since)
    event_counts = {name.value: count for name, count in event_counts_raw.items()}

    logins_by_day_user = [
        LoginsByDayUser(
            day=day.date().isoformat(),
            user_id=user_id,
            user_email=user_email,
            platform=platform,
            count=count,
        )
        for day, user_id, user_email, platform, count in analytics_event_crud.count_logins_by_day_and_user(
            session=session, since=since
        )
    ]

    total_users = session.exec(select(func.count()).select_from(User)).one()

    return AnalyticsOverview(
        window_days=window_days,
        total_users=total_users,
        users_with_push_token=_users_with_push_token(session=session),
        logins_by_day_user=logins_by_day_user,
        event_counts=event_counts,
        invites_sent=event_counts.get(AnalyticsEventName.INVITE_SENT.value, 0),
        invites_opened=_count_invites_opened(session=session, since=since),
        notification_opt_in=_notification_opt_in_breakdown(session=session),
        notifications_sent=_count_notifications_sent(session=session, since=since),
        notifications_clicked=event_counts.get(
            AnalyticsEventName.NOTIFICATION_CLICKED.value, 0
        ),
    )
