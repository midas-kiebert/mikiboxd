from uuid import UUID

from sqlmodel import SQLModel


class OpensByDayUser(SQLModel):
    day: str
    user_id: UUID
    user_email: str
    platform: str | None
    count: int


class NotificationOptInBreakdown(SQLModel):
    setting: str
    enabled_count: int
    disabled_count: int


class AnalyticsOverview(SQLModel):
    window_days: int
    total_users: int
    users_with_push_token: int
    opens_by_day_user: list[OpensByDayUser]
    event_counts: dict[str, int]
    invites_sent: int
    invites_opened: int
    notification_opt_in: list[NotificationOptInBreakdown]
    notifications_sent: int
    notifications_clicked: int
