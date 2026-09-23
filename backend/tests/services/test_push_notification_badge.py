"""The app-icon badge number: what it counts, and that pushes carry it.

The badge is deliberately not the same sum as the in-app bell — see
``push_notifications.badge_count``. The tests that pin that difference down are
the point of this file: unseen events *plus* pending friend requests, with the
friend-request part surviving a mark-seen.
"""

from uuid import uuid4

from pytest_mock import MockerFixture
from sqlmodel import Session

from app.core.enums import NotificationChannel, NotificationType
from app.crud import friendship as friendship_crud
from app.crud import notification as notification_crud
from app.crud import showtime_ping as showtime_ping_crud
from app.services import push_notifications
from app.utils import now_amsterdam_naive


def test_badge_count_is_zero_with_nothing_waiting(
    db_transaction: Session, user_factory
) -> None:
    user = user_factory()

    assert (
        push_notifications.badge_count(session=db_transaction, user_id=user.id) == 0
    )


def test_badge_count_sums_notifications_invites_and_friend_requests(
    db_transaction: Session, user_factory, showtime_factory
) -> None:
    recipient = user_factory()
    actor = user_factory()
    requester = user_factory()
    showtime = showtime_factory()
    now = now_amsterdam_naive()

    notification_crud.upsert_notification(
        session=db_transaction,
        user_id=recipient.id,
        type=NotificationType.FRIEND_SHOWTIME_MATCH,
        actor_id=actor.id,
        showtime_id=showtime.id,
        created_at=now,
    )
    showtime_ping_crud.create_showtime_ping(
        session=db_transaction,
        showtime_id=showtime.id,
        sender_id=actor.id,
        receiver_id=recipient.id,
        created_at=now,
    )
    friendship_crud.create_friend_request(
        session=db_transaction,
        sender_id=requester.id,
        receiver_id=recipient.id,
    )

    assert (
        push_notifications.badge_count(session=db_transaction, user_id=recipient.id)
        == 3
    )


def test_badge_count_keeps_friend_requests_after_everything_is_seen(
    db_transaction: Session, user_factory, showtime_factory
) -> None:
    """The whole reason the badge is not the bell's number.

    Opening the notification centre marks events seen and zeroes the bell. A
    friend request is not an event that can be "seen" away — it is outstanding
    until accepted or declined — so it must survive that and keep the icon lit.
    """
    recipient = user_factory()
    actor = user_factory()
    requester = user_factory()
    showtime = showtime_factory()
    now = now_amsterdam_naive()

    notification_crud.upsert_notification(
        session=db_transaction,
        user_id=recipient.id,
        type=NotificationType.FRIEND_SHOWTIME_MATCH,
        actor_id=actor.id,
        showtime_id=showtime.id,
        created_at=now,
    )
    showtime_ping_crud.create_showtime_ping(
        session=db_transaction,
        showtime_id=showtime.id,
        sender_id=actor.id,
        receiver_id=recipient.id,
        created_at=now,
    )
    friendship_crud.create_friend_request(
        session=db_transaction,
        sender_id=requester.id,
        receiver_id=recipient.id,
    )

    notification_crud.mark_seen(
        session=db_transaction, user_id=recipient.id, seen_at=now
    )
    showtime_ping_crud.mark_received_showtime_pings_seen(
        session=db_transaction, receiver_id=recipient.id, seen_at=now
    )

    assert (
        push_notifications.badge_count(session=db_transaction, user_id=recipient.id)
        == 1
    )

    friendship_crud.delete_friend_request(
        session=db_transaction,
        sender_id=requester.id,
        receiver_id=recipient.id,
    )

    assert (
        push_notifications.badge_count(session=db_transaction, user_id=recipient.id)
        == 0
    )


def test_badge_count_ignores_dismissed_notifications(
    db_transaction: Session, user_factory, showtime_factory
) -> None:
    recipient = user_factory()
    actor = user_factory()
    showtime = showtime_factory()
    now = now_amsterdam_naive()

    created = notification_crud.upsert_notification(
        session=db_transaction,
        user_id=recipient.id,
        type=NotificationType.FRIEND_SHOWTIME_MATCH,
        actor_id=actor.id,
        showtime_id=showtime.id,
        created_at=now,
    )
    created.dismissed_at = now
    db_transaction.add(created)
    db_transaction.flush()

    assert (
        push_notifications.badge_count(session=db_transaction, user_id=recipient.id)
        == 0
    )


def test_friend_request_push_carries_the_badge(mocker: MockerFixture) -> None:
    """iOS writes the badge absolutely, so every push has to state the number."""
    session = mocker.MagicMock()
    sender_id = uuid4()
    receiver_id = uuid4()

    sender = mocker.MagicMock(display_name="Alex")
    receiver = mocker.MagicMock(
        notify_on_friend_requests=True,
        notify_channel_friend_requests=NotificationChannel.PUSH,
    )
    token = mocker.MagicMock(token="ExponentPushToken[abc]")

    mocker.patch(
        "app.services.push_notifications.user_crud.get_user_by_id",
        side_effect=[sender, receiver],
    )
    mocker.patch(
        "app.services.push_notifications.push_token_crud.get_push_tokens_for_users",
        return_value=[token],
    )
    mocker.patch(
        "app.services.push_notifications.badge_count",
        return_value=4,
    )
    send_messages = mocker.patch(
        "app.services.push_notifications._send_expo_messages",
        return_value=[{"status": "ok"}],
    )
    mocker.patch("app.services.push_notifications._handle_expo_results")

    push_notifications.notify_user_on_friend_request(
        session=session,
        sender_id=sender_id,
        receiver_id=receiver_id,
    )

    sent_payload = send_messages.call_args.args[0]
    assert sent_payload[0]["badge"] == 4


def test_fan_out_gives_each_recipient_their_own_badge(mocker: MockerFixture) -> None:
    """A device gets its owner's number, not whatever the last recipient had."""
    session = mocker.MagicMock()
    first_id = uuid4()
    second_id = uuid4()

    badges = {first_id: 2, second_id: 7}
    mocker.patch(
        "app.services.push_notifications.badge_count",
        side_effect=lambda *, session, user_id: badges[user_id],
    )

    result = push_notifications._badges_for(
        session=session,
        # The first user has two devices; they must be counted once and agree.
        user_ids=[first_id, second_id, first_id],
    )

    assert result == {first_id: 2, second_id: 7}


def test_email_recipients_get_no_push_and_so_no_badge(mocker: MockerFixture) -> None:
    """The badge rides on the push; an email recipient has no push to ride on.

    Their icon is left at whatever the last push set, and corrects itself the
    next time the app is opened — there is no APNs delivery to carry a number.
    """
    session = mocker.MagicMock()
    sender = mocker.MagicMock(display_name="Alex")
    receiver = mocker.MagicMock(
        notify_on_friend_requests=True,
        notify_channel_friend_requests=NotificationChannel.EMAIL,
    )

    mocker.patch(
        "app.services.push_notifications.user_crud.get_user_by_id",
        side_effect=[sender, receiver],
    )
    mocker.patch("app.services.push_notifications._send_templated_email")
    send_messages = mocker.patch(
        "app.services.push_notifications._send_expo_messages"
    )

    push_notifications.notify_user_on_friend_request(
        session=session,
        sender_id=uuid4(),
        receiver_id=uuid4(),
    )

    send_messages.assert_not_called()
