from datetime import datetime
from uuid import UUID

from sqlmodel import Session, select

from app.models.showtime_reminder import ShowtimeReminder


def get_showtime_reminder(
    *,
    session: Session,
    showtime_id: int,
    receiver_id: UUID,
) -> ShowtimeReminder | None:
    stmt = select(ShowtimeReminder).where(
        ShowtimeReminder.showtime_id == showtime_id,
        ShowtimeReminder.receiver_id == receiver_id,
    )
    return session.exec(stmt).one_or_none()


def record_showtime_reminder(
    *,
    session: Session,
    showtime_id: int,
    sender_id: UUID,
    receiver_id: UUID,
    sent_at: datetime,
) -> ShowtimeReminder:
    """Upsert the (showtime, receiver) cooldown row to the latest send.

    Whoever sends a reminder resets the cooldown for every future sender, not
    just themselves — see `ShowtimeReminder`.
    """
    reminder = get_showtime_reminder(
        session=session, showtime_id=showtime_id, receiver_id=receiver_id
    )
    if reminder is None:
        reminder = ShowtimeReminder(
            showtime_id=showtime_id,
            receiver_id=receiver_id,
            sender_id=sender_id,
            sent_at=sent_at,
        )
    else:
        reminder.sender_id = sender_id
        reminder.sent_at = sent_at
    session.add(reminder)
    session.flush()
    return reminder
