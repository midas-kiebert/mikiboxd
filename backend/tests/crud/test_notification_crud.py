from datetime import timedelta

from sqlmodel import Session

from app.core.enums import NotificationType
from app.crud import notification as notification_crud
from app.utils import now_amsterdam_naive


def _make_users_and_showtime(user_factory, showtime_factory):
    recipient = user_factory()
    actor = user_factory()
    showtime = showtime_factory()
    return recipient, actor, showtime


def test_upsert_creates_then_refreshes_existing_row(
    db_transaction: Session, user_factory, showtime_factory
) -> None:
    recipient, actor, showtime = _make_users_and_showtime(user_factory, showtime_factory)
    first_time = now_amsterdam_naive() - timedelta(hours=1)

    created = notification_crud.upsert_notification(
        session=db_transaction,
        user_id=recipient.id,
        type=NotificationType.FRIEND_SHOWTIME_MATCH,
        actor_id=actor.id,
        showtime_id=showtime.id,
        created_at=first_time,
    )
    # Simulate the recipient having seen then dismissed it.
    created.seen_at = first_time
    created.dismissed_at = first_time
    db_transaction.add(created)
    db_transaction.flush()

    later = now_amsterdam_naive()
    refreshed = notification_crud.upsert_notification(
        session=db_transaction,
        user_id=recipient.id,
        type=NotificationType.FRIEND_SHOWTIME_MATCH,
        actor_id=actor.id,
        showtime_id=showtime.id,
        created_at=later,
    )

    assert refreshed.id == created.id
    assert refreshed.created_at == later
    assert refreshed.seen_at is None
    assert refreshed.dismissed_at is None


def test_upsert_friend_request_accepted_dedupes_on_null_showtime(
    db_transaction: Session, user_factory
) -> None:
    recipient = user_factory()
    actor = user_factory()
    now = now_amsterdam_naive()

    first = notification_crud.upsert_notification(
        session=db_transaction,
        user_id=recipient.id,
        type=NotificationType.FRIEND_REQUEST_ACCEPTED,
        actor_id=actor.id,
        showtime_id=None,
        created_at=now,
    )
    second = notification_crud.upsert_notification(
        session=db_transaction,
        user_id=recipient.id,
        type=NotificationType.FRIEND_REQUEST_ACCEPTED,
        actor_id=actor.id,
        showtime_id=None,
        created_at=now,
    )

    assert first.id == second.id


def test_delete_showtime_notifications_removes_matching_types(
    db_transaction: Session, user_factory, showtime_factory
) -> None:
    recipient, actor, showtime = _make_users_and_showtime(user_factory, showtime_factory)
    now = now_amsterdam_naive()
    notification_crud.upsert_notification(
        session=db_transaction,
        user_id=recipient.id,
        type=NotificationType.FRIEND_SHOWTIME_MATCH,
        actor_id=actor.id,
        showtime_id=showtime.id,
        created_at=now,
    )

    deleted = notification_crud.delete_showtime_notifications(
        session=db_transaction,
        actor_id=actor.id,
        showtime_id=showtime.id,
        types=[
            NotificationType.FRIEND_SHOWTIME_MATCH,
            NotificationType.INVITE_RESPONSE,
        ],
    )

    assert deleted == 1
    assert notification_crud.get_feed_notifications(
        session=db_transaction, user_id=recipient.id, limit=10, offset=0
    ) == []


def test_delete_showtime_notifications_can_scope_to_one_recipient(
    db_transaction: Session, user_factory, showtime_factory
) -> None:
    recipient_a = user_factory()
    recipient_b = user_factory()
    actor = user_factory()
    showtime = showtime_factory()
    now = now_amsterdam_naive()
    for recipient in (recipient_a, recipient_b):
        notification_crud.upsert_notification(
            session=db_transaction,
            user_id=recipient.id,
            type=NotificationType.FRIEND_SHOWTIME_MATCH,
            actor_id=actor.id,
            showtime_id=showtime.id,
            created_at=now,
        )

    deleted = notification_crud.delete_showtime_notifications(
        session=db_transaction,
        actor_id=actor.id,
        showtime_id=showtime.id,
        types=[NotificationType.FRIEND_SHOWTIME_MATCH],
        user_id=recipient_a.id,
    )

    assert deleted == 1
    assert (
        len(
            notification_crud.get_feed_notifications(
                session=db_transaction, user_id=recipient_b.id, limit=10, offset=0
            )
        )
        == 1
    )


def test_get_feed_excludes_dismissed_and_orders_newest_first(
    db_transaction: Session, user_factory, showtime_factory
) -> None:
    recipient = user_factory()
    actor_old = user_factory()
    actor_new = user_factory()
    actor_dismissed = user_factory()
    showtime = showtime_factory()
    now = now_amsterdam_naive()

    notification_crud.upsert_notification(
        session=db_transaction,
        user_id=recipient.id,
        type=NotificationType.FRIEND_SHOWTIME_MATCH,
        actor_id=actor_old.id,
        showtime_id=showtime.id,
        created_at=now - timedelta(hours=2),
    )
    notification_crud.upsert_notification(
        session=db_transaction,
        user_id=recipient.id,
        type=NotificationType.FRIEND_SHOWTIME_MATCH,
        actor_id=actor_new.id,
        showtime_id=showtime.id,
        created_at=now,
    )
    dismissed = notification_crud.upsert_notification(
        session=db_transaction,
        user_id=recipient.id,
        type=NotificationType.FRIEND_SHOWTIME_MATCH,
        actor_id=actor_dismissed.id,
        showtime_id=showtime.id,
        created_at=now - timedelta(hours=1),
    )
    notification_crud.dismiss(
        session=db_transaction,
        notification_id=dismissed.id,  # type: ignore[arg-type]
        user_id=recipient.id,
        dismissed_at=now,
    )

    feed = notification_crud.get_feed_notifications(
        session=db_transaction, user_id=recipient.id, limit=10, offset=0
    )

    assert [item.actor_id for item in feed] == [actor_new.id, actor_old.id]


def test_unseen_count_and_mark_seen(
    db_transaction: Session, user_factory, showtime_factory
) -> None:
    recipient, actor, showtime = _make_users_and_showtime(user_factory, showtime_factory)
    notification_crud.upsert_notification(
        session=db_transaction,
        user_id=recipient.id,
        type=NotificationType.FRIEND_SHOWTIME_MATCH,
        actor_id=actor.id,
        showtime_id=showtime.id,
        created_at=now_amsterdam_naive(),
    )

    assert notification_crud.get_unseen_count(
        session=db_transaction, user_id=recipient.id
    ) == 1

    notification_crud.mark_seen(
        session=db_transaction, user_id=recipient.id, seen_at=now_amsterdam_naive()
    )

    assert notification_crud.get_unseen_count(
        session=db_transaction, user_id=recipient.id
    ) == 0


def test_dismiss_rejects_other_users(
    db_transaction: Session, user_factory, showtime_factory
) -> None:
    recipient, actor, showtime = _make_users_and_showtime(user_factory, showtime_factory)
    stranger = user_factory()
    notification = notification_crud.upsert_notification(
        session=db_transaction,
        user_id=recipient.id,
        type=NotificationType.FRIEND_SHOWTIME_MATCH,
        actor_id=actor.id,
        showtime_id=showtime.id,
        created_at=now_amsterdam_naive(),
    )

    assert (
        notification_crud.dismiss(
            session=db_transaction,
            notification_id=notification.id,  # type: ignore[arg-type]
            user_id=stranger.id,
            dismissed_at=now_amsterdam_naive(),
        )
        is False
    )


def test_delete_past_showtime_notifications(
    db_transaction: Session, user_factory, showtime_factory
) -> None:
    recipient = user_factory()
    actor = user_factory()
    now = now_amsterdam_naive()
    past_showtime = showtime_factory(datetime=now - timedelta(days=1))
    future_showtime = showtime_factory(datetime=now + timedelta(days=1))
    for showtime in (past_showtime, future_showtime):
        notification_crud.upsert_notification(
            session=db_transaction,
            user_id=recipient.id,
            type=NotificationType.FRIEND_SHOWTIME_MATCH,
            actor_id=actor.id,
            showtime_id=showtime.id,
            created_at=now,
        )

    deleted = notification_crud.delete_past_showtime_notifications(
        session=db_transaction, user_id=recipient.id, now=now
    )

    assert deleted == 1
    remaining = notification_crud.get_feed_notifications(
        session=db_transaction, user_id=recipient.id, limit=10, offset=0
    )
    assert [item.showtime_id for item in remaining] == [future_showtime.id]


def test_delete_stale_notifications(
    db_transaction: Session, user_factory, showtime_factory
) -> None:
    recipient = user_factory()
    actor_old = user_factory()
    actor_dismissed = user_factory()
    actor_fresh = user_factory()
    showtime = showtime_factory()
    now = now_amsterdam_naive()

    notification_crud.upsert_notification(
        session=db_transaction,
        user_id=recipient.id,
        type=NotificationType.FRIEND_SHOWTIME_MATCH,
        actor_id=actor_old.id,
        showtime_id=showtime.id,
        created_at=now - timedelta(days=40),
    )
    dismissed = notification_crud.upsert_notification(
        session=db_transaction,
        user_id=recipient.id,
        type=NotificationType.FRIEND_SHOWTIME_MATCH,
        actor_id=actor_dismissed.id,
        showtime_id=showtime.id,
        created_at=now,
    )
    notification_crud.dismiss(
        session=db_transaction,
        notification_id=dismissed.id,  # type: ignore[arg-type]
        user_id=recipient.id,
        dismissed_at=now,
    )
    notification_crud.upsert_notification(
        session=db_transaction,
        user_id=recipient.id,
        type=NotificationType.FRIEND_SHOWTIME_MATCH,
        actor_id=actor_fresh.id,
        showtime_id=showtime.id,
        created_at=now,
    )

    deleted = notification_crud.delete_stale_notifications(
        session=db_transaction, now=now, max_age=timedelta(days=30)
    )

    assert deleted == 2
    remaining = notification_crud.get_feed_notifications(
        session=db_transaction, user_id=recipient.id, limit=10, offset=0
    )
    assert [item.actor_id for item in remaining] == [actor_fresh.id]
