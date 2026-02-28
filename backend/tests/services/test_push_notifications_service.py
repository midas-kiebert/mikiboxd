from datetime import timedelta
from uuid import uuid4

from pytest_mock import MockerFixture

from app.core.enums import GoingStatus, NotificationChannel
from app.services import push_notifications
from app.utils import now_amsterdam_naive


def test_notify_friends_only_for_opted_in_recipients(
    mocker: MockerFixture,
) -> None:
    actor_id = uuid4()
    recipient_opted_in_id = uuid4()
    recipient_opted_out_id = uuid4()

    session = mocker.MagicMock()
    showtime = mocker.MagicMock()
    showtime.id = 123
    showtime.movie_id = 456
    showtime.movie = mocker.MagicMock(title="In the Mood for Love")

    actor = mocker.MagicMock(display_name="Alex")
    recipient_opted_in = mocker.MagicMock(
        id=recipient_opted_in_id,
        notify_on_friend_showtime_match=True,
        notify_channel_friend_showtime_match=NotificationChannel.PUSH,
    )
    recipient_opted_out = mocker.MagicMock(
        id=recipient_opted_out_id,
        notify_on_friend_showtime_match=False,
        notify_channel_friend_showtime_match=NotificationChannel.PUSH,
    )
    token = mocker.MagicMock(token="ExponentPushToken[abc]")

    mocker.patch(
        "app.services.push_notifications.user_crud.get_user_by_id",
        return_value=actor,
    )
    mocker.patch(
        "app.services.push_notifications.showtime_crud.get_friends_with_showtime_selection",
        return_value=[recipient_opted_in, recipient_opted_out],
    )
    get_tokens = mocker.patch(
        "app.services.push_notifications.push_token_crud.get_push_tokens_for_users",
        return_value=[token],
    )
    send_messages = mocker.patch(
        "app.services.push_notifications._send_expo_messages",
        return_value=[{"status": "ok"}],
    )
    handle_results = mocker.patch("app.services.push_notifications._handle_expo_results")

    push_notifications.notify_friends_on_showtime_selection(
        session=session,
        actor_id=actor_id,
        showtime=showtime,
        previous_status=GoingStatus.NOT_GOING,
        going_status=GoingStatus.GOING,
    )

    get_tokens.assert_called_once_with(
        session=session,
        user_ids=[recipient_opted_in_id],
    )
    send_messages.assert_called_once()
    sent_payload = send_messages.call_args.args[0]
    assert len(sent_payload) == 1
    assert sent_payload[0]["to"] == token.token
    assert sent_payload[0]["title"] == "Alex is going"
    assert sent_payload[0]["body"] == showtime.movie.title
    assert "richContent" not in sent_payload[0]
    handle_results.assert_called_once()


def test_notify_friends_uses_email_channel_when_selected(
    mocker: MockerFixture,
) -> None:
    session = mocker.MagicMock()
    actor_id = uuid4()
    recipient_id = uuid4()
    showtime = mocker.MagicMock(id=111, movie_id=222, movie=mocker.MagicMock(title="Movie"))
    actor = mocker.MagicMock(display_name="Alex")
    recipient = mocker.MagicMock(
        id=recipient_id,
        email="friend@example.com",
        notify_on_friend_showtime_match=True,
        notify_channel_friend_showtime_match=NotificationChannel.EMAIL,
    )

    mocker.patch(
        "app.services.push_notifications.user_crud.get_user_by_id",
        return_value=actor,
    )
    mocker.patch(
        "app.services.push_notifications.showtime_crud.get_friends_with_showtime_selection",
        return_value=[recipient],
    )
    get_tokens = mocker.patch(
        "app.services.push_notifications.push_token_crud.get_push_tokens_for_users",
    )
    send_email = mocker.patch(
        "app.services.push_notifications._send_email_notification",
        return_value=True,
    )

    push_notifications.notify_friends_on_showtime_selection(
        session=session,
        actor_id=actor_id,
        showtime=showtime,
        previous_status=GoingStatus.NOT_GOING,
        going_status=GoingStatus.GOING,
    )

    get_tokens.assert_not_called()
    send_email.assert_called_once_with(
        email_to="friend@example.com",
        subject="Alex is going",
        body="Movie",
    )


def test_notify_friends_skips_when_no_opted_in_recipients(
    mocker: MockerFixture,
) -> None:
    session = mocker.MagicMock()
    showtime = mocker.MagicMock(id=111, movie_id=222, movie=mocker.MagicMock(title="Movie"))
    actor = mocker.MagicMock(display_name="Alex")
    recipient_opted_out = mocker.MagicMock(
        id=uuid4(),
        notify_on_friend_showtime_match=False,
        notify_channel_friend_showtime_match=NotificationChannel.PUSH,
    )

    mocker.patch(
        "app.services.push_notifications.user_crud.get_user_by_id",
        return_value=actor,
    )
    mocker.patch(
        "app.services.push_notifications.showtime_crud.get_friends_with_showtime_selection",
        return_value=[recipient_opted_out],
    )
    get_tokens = mocker.patch(
        "app.services.push_notifications.push_token_crud.get_push_tokens_for_users",
    )
    send_messages = mocker.patch("app.services.push_notifications._send_expo_messages")

    push_notifications.notify_friends_on_showtime_selection(
        session=session,
        actor_id=uuid4(),
        showtime=showtime,
        previous_status=GoingStatus.NOT_GOING,
        going_status=GoingStatus.GOING,
    )

    get_tokens.assert_not_called()
    send_messages.assert_not_called()


def test_notify_friends_skips_when_recipient_is_hidden_by_visibility(
    mocker: MockerFixture,
) -> None:
    session = mocker.MagicMock()
    showtime = mocker.MagicMock(id=111, movie_id=222, movie=mocker.MagicMock(title="Movie"))
    actor = mocker.MagicMock(display_name="Alex")
    recipient = mocker.MagicMock(
        id=uuid4(),
        notify_on_friend_showtime_match=True,
        notify_channel_friend_showtime_match=NotificationChannel.PUSH,
    )

    mocker.patch(
        "app.services.push_notifications.user_crud.get_user_by_id",
        return_value=actor,
    )
    mocker.patch(
        "app.services.push_notifications.showtime_crud.get_friends_with_showtime_selection",
        return_value=[recipient],
    )
    mocker.patch(
        "app.services.push_notifications.showtime_visibility_crud.is_showtime_visible_to_viewer_for_ids",
        return_value=False,
    )
    get_tokens = mocker.patch(
        "app.services.push_notifications.push_token_crud.get_push_tokens_for_users",
    )
    send_messages = mocker.patch("app.services.push_notifications._send_expo_messages")
    send_email = mocker.patch("app.services.push_notifications._send_email_notification")

    push_notifications.notify_friends_on_showtime_selection(
        session=session,
        actor_id=uuid4(),
        showtime=showtime,
        previous_status=GoingStatus.NOT_GOING,
        going_status=GoingStatus.GOING,
    )

    get_tokens.assert_not_called()
    send_messages.assert_not_called()
    send_email.assert_not_called()


def test_notify_friends_sends_no_longer_selected_status(
    mocker: MockerFixture,
) -> None:
    session = mocker.MagicMock()
    actor_id = uuid4()
    recipient_id = uuid4()
    showtime = mocker.MagicMock(id=111, movie_id=222, movie=mocker.MagicMock(title="Movie"))
    actor = mocker.MagicMock(display_name="Alex")
    recipient = mocker.MagicMock(
        id=recipient_id,
        notify_on_friend_showtime_match=True,
        notify_channel_friend_showtime_match=NotificationChannel.PUSH,
    )
    token = mocker.MagicMock(token="ExponentPushToken[abc]")

    mocker.patch(
        "app.services.push_notifications.user_crud.get_user_by_id",
        return_value=actor,
    )
    mocker.patch(
        "app.services.push_notifications.showtime_crud.get_friends_with_showtime_selection",
        return_value=[recipient],
    )
    mocker.patch(
        "app.services.push_notifications.push_token_crud.get_push_tokens_for_users",
        return_value=[token],
    )
    send_messages = mocker.patch(
        "app.services.push_notifications._send_expo_messages",
        return_value=[{"status": "ok"}],
    )
    mocker.patch("app.services.push_notifications._handle_expo_results")

    push_notifications.notify_friends_on_showtime_selection(
        session=session,
        actor_id=actor_id,
        showtime=showtime,
        previous_status=GoingStatus.INTERESTED,
        going_status=GoingStatus.NOT_GOING,
    )

    sent_payload = send_messages.call_args.args[0]
    assert len(sent_payload) == 1
    assert sent_payload[0]["title"] == "Alex is no longer interested"
    assert sent_payload[0]["data"]["type"] == "showtime_status_removed"
    assert sent_payload[0]["data"]["status"] == GoingStatus.NOT_GOING.value
    assert sent_payload[0]["data"]["previousStatus"] == GoingStatus.INTERESTED.value


def test_notify_friends_sends_no_longer_going_when_status_downgrades(
    mocker: MockerFixture,
) -> None:
    session = mocker.MagicMock()
    showtime = mocker.MagicMock(id=111, movie_id=222, movie=mocker.MagicMock(title="Movie"))
    actor = mocker.MagicMock(display_name="Alex")
    recipient = mocker.MagicMock(
        id=uuid4(),
        notify_on_friend_showtime_match=True,
        notify_channel_friend_showtime_match=NotificationChannel.PUSH,
    )
    token = mocker.MagicMock(token="ExponentPushToken[abc]")

    mocker.patch(
        "app.services.push_notifications.user_crud.get_user_by_id",
        return_value=actor,
    )
    mocker.patch(
        "app.services.push_notifications.showtime_crud.get_friends_with_showtime_selection",
        return_value=[recipient],
    )
    mocker.patch(
        "app.services.push_notifications.push_token_crud.get_push_tokens_for_users",
        return_value=[token],
    )
    send_messages = mocker.patch(
        "app.services.push_notifications._send_expo_messages",
        return_value=[{"status": "ok"}],
    )
    mocker.patch("app.services.push_notifications._handle_expo_results")

    push_notifications.notify_friends_on_showtime_selection(
        session=session,
        actor_id=uuid4(),
        showtime=showtime,
        previous_status=GoingStatus.GOING,
        going_status=GoingStatus.INTERESTED,
    )

    sent_payload = send_messages.call_args.args[0]
    assert len(sent_payload) == 1
    assert sent_payload[0]["title"] == "Alex is no longer going"
    assert sent_payload[0]["data"]["type"] == "showtime_status_removed"
    assert sent_payload[0]["data"]["status"] == GoingStatus.INTERESTED.value
    assert sent_payload[0]["data"]["previousStatus"] == GoingStatus.GOING.value


def test_notify_user_on_friend_request(
    mocker: MockerFixture,
) -> None:
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
    get_tokens = mocker.patch(
        "app.services.push_notifications.push_token_crud.get_push_tokens_for_users",
        return_value=[token],
    )
    send_messages = mocker.patch(
        "app.services.push_notifications._send_expo_messages",
        return_value=[{"status": "ok"}],
    )
    handle_results = mocker.patch("app.services.push_notifications._handle_expo_results")

    push_notifications.notify_user_on_friend_request(
        session=session,
        sender_id=sender_id,
        receiver_id=receiver_id,
    )

    get_tokens.assert_called_once_with(
        session=session,
        user_ids=[receiver_id],
    )
    send_messages.assert_called_once()
    sent_payload = send_messages.call_args.args[0]
    assert len(sent_payload) == 1
    assert sent_payload[0]["to"] == token.token
    assert sent_payload[0]["title"] == "New friend request"
    assert sent_payload[0]["body"] == "Alex sent you a friend request"
    assert sent_payload[0]["data"]["type"] == "friend_request_received"
    assert sent_payload[0]["data"]["senderId"] == str(sender_id)
    assert "richContent" not in sent_payload[0]
    handle_results.assert_called_once()


def test_notify_user_on_friend_request_uses_email_channel(
    mocker: MockerFixture,
) -> None:
    session = mocker.MagicMock()
    sender_id = uuid4()
    receiver_id = uuid4()

    sender = mocker.MagicMock(display_name="Alex")
    receiver = mocker.MagicMock(
        email="friend@example.com",
        notify_on_friend_requests=True,
        notify_channel_friend_requests=NotificationChannel.EMAIL,
    )
    mocker.patch(
        "app.services.push_notifications.user_crud.get_user_by_id",
        side_effect=[sender, receiver],
    )
    get_tokens = mocker.patch(
        "app.services.push_notifications.push_token_crud.get_push_tokens_for_users",
    )
    send_email = mocker.patch(
        "app.services.push_notifications._send_email_notification",
        return_value=True,
    )

    push_notifications.notify_user_on_friend_request(
        session=session,
        sender_id=sender_id,
        receiver_id=receiver_id,
    )

    get_tokens.assert_not_called()
    send_email.assert_called_once_with(
        email_to="friend@example.com",
        subject="New friend request",
        body="Alex sent you a friend request",
    )


def test_notify_user_on_friend_request_accepted(
    mocker: MockerFixture,
) -> None:
    session = mocker.MagicMock()
    accepter_id = uuid4()
    requester_id = uuid4()

    accepter = mocker.MagicMock(display_name="Alex")
    requester = mocker.MagicMock(
        notify_on_friend_requests=True,
        notify_channel_friend_requests=NotificationChannel.PUSH,
    )
    token = mocker.MagicMock(token="ExponentPushToken[abc]")

    mocker.patch(
        "app.services.push_notifications.user_crud.get_user_by_id",
        side_effect=[accepter, requester],
    )
    get_tokens = mocker.patch(
        "app.services.push_notifications.push_token_crud.get_push_tokens_for_users",
        return_value=[token],
    )
    send_messages = mocker.patch(
        "app.services.push_notifications._send_expo_messages",
        return_value=[{"status": "ok"}],
    )
    handle_results = mocker.patch("app.services.push_notifications._handle_expo_results")

    push_notifications.notify_user_on_friend_request_accepted(
        session=session,
        accepter_id=accepter_id,
        requester_id=requester_id,
    )

    get_tokens.assert_called_once_with(
        session=session,
        user_ids=[requester_id],
    )
    send_messages.assert_called_once()
    sent_payload = send_messages.call_args.args[0]
    assert len(sent_payload) == 1
    assert sent_payload[0]["to"] == token.token
    assert sent_payload[0]["title"] == "Friend request accepted"
    assert sent_payload[0]["body"] == "Alex accepted your friend request"
    assert sent_payload[0]["data"]["type"] == "friend_request_accepted"
    assert sent_payload[0]["data"]["accepterId"] == str(accepter_id)
    assert "richContent" not in sent_payload[0]
    handle_results.assert_called_once()


def test_notify_user_on_showtime_ping(
    mocker: MockerFixture,
) -> None:
    session = mocker.MagicMock()
    sender_id = uuid4()
    receiver_id = uuid4()
    showtime = mocker.MagicMock()
    showtime.id = 42
    showtime.movie_id = 77
    showtime.datetime = now_amsterdam_naive() + timedelta(days=1)
    showtime.movie = mocker.MagicMock(title="Memories of Murder")

    sender = mocker.MagicMock(display_name="Alex")
    receiver = mocker.MagicMock(
        notify_on_showtime_ping=True,
        notify_channel_showtime_ping=NotificationChannel.PUSH,
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
    send_messages = mocker.patch(
        "app.services.push_notifications._send_expo_messages",
        return_value=[{"status": "ok"}],
    )
    handle_results = mocker.patch("app.services.push_notifications._handle_expo_results")

    push_notifications.notify_user_on_showtime_ping(
        session=session,
        sender_id=sender_id,
        receiver_id=receiver_id,
        showtime=showtime,
    )

    sent_payload = send_messages.call_args.args[0]
    assert len(sent_payload) == 1
    assert sent_payload[0]["title"] == "Alex pinged you"
    assert sent_payload[0]["data"]["type"] == "showtime_ping"
    assert sent_payload[0]["data"]["showtimeId"] == showtime.id
    assert sent_payload[0]["data"]["movieId"] == showtime.movie_id
    assert sent_payload[0]["data"]["senderId"] == str(sender_id)
    handle_results.assert_called_once()


def test_notify_user_on_showtime_ping_uses_email_channel(
    mocker: MockerFixture,
) -> None:
    session = mocker.MagicMock()
    sender_id = uuid4()
    receiver_id = uuid4()
    showtime = mocker.MagicMock()
    showtime.id = 42
    showtime.movie_id = 77
    showtime.datetime = now_amsterdam_naive() + timedelta(days=1)
    showtime.movie = mocker.MagicMock(title="Memories of Murder")

    sender = mocker.MagicMock(display_name="Alex")
    receiver = mocker.MagicMock(
        email="friend@example.com",
        notify_on_showtime_ping=True,
        notify_channel_showtime_ping=NotificationChannel.EMAIL,
    )
    mocker.patch(
        "app.services.push_notifications.user_crud.get_user_by_id",
        side_effect=[sender, receiver],
    )
    get_tokens = mocker.patch(
        "app.services.push_notifications.push_token_crud.get_push_tokens_for_users",
    )
    send_email = mocker.patch(
        "app.services.push_notifications._send_email_notification",
        return_value=True,
    )

    push_notifications.notify_user_on_showtime_ping(
        session=session,
        sender_id=sender_id,
        receiver_id=receiver_id,
        showtime=showtime,
    )

    get_tokens.assert_not_called()
    send_email.assert_called_once()
    email_call = send_email.call_args.kwargs
    assert email_call["email_to"] == "friend@example.com"
    assert email_call["subject"] == "Alex pinged you"
    assert "Memories of Murder" in email_call["body"]


def test_send_interested_showtime_reminders_marks_selection_as_sent(
    mocker: MockerFixture,
) -> None:
    session = mocker.MagicMock()
    user_id = uuid4()
    now = now_amsterdam_naive()

    showtime = mocker.MagicMock()
    showtime.id = 123
    showtime.movie_id = 456
    showtime.datetime = now + timedelta(hours=23)
    showtime.movie = mocker.MagicMock(title="Perfect Days")
    selection = mocker.MagicMock()
    selection.user_id = user_id
    selection.going_status = GoingStatus.INTERESTED
    selection.interested_reminder_sent_at = None

    mocker.patch(
        "app.services.push_notifications.showtime_crud.get_interested_reminder_candidates",
        return_value=[(selection, showtime)],
    )
    mocker.patch(
        "app.services.push_notifications.push_token_crud.get_push_tokens_for_users",
        return_value=[mocker.MagicMock(token="ExponentPushToken[abc]", user_id=user_id)],
    )
    mocker.patch(
        "app.services.push_notifications.user_crud.get_users_by_ids",
        return_value=[
            mocker.MagicMock(
                id=user_id,
                notify_on_interest_reminder=True,
                notify_channel_interest_reminder=NotificationChannel.PUSH,
            )
        ],
    )
    send_messages = mocker.patch(
        "app.services.push_notifications._send_expo_messages",
        return_value=[{"status": "ok"}],
    )
    mocker.patch("app.services.push_notifications._handle_expo_results")

    sent_count = push_notifications.send_interested_showtime_reminders(
        session=session,
        now=now,
    )

    assert sent_count == 1
    assert selection.interested_reminder_sent_at == now
    send_messages.assert_called_once()
    session.commit.assert_called_once()


def test_send_interested_showtime_reminders_uses_email_channel(
    mocker: MockerFixture,
) -> None:
    session = mocker.MagicMock()
    user_id = uuid4()
    now = now_amsterdam_naive()

    showtime = mocker.MagicMock()
    showtime.id = 123
    showtime.movie_id = 456
    showtime.datetime = now + timedelta(hours=23)
    showtime.movie = mocker.MagicMock(title="Perfect Days")
    selection = mocker.MagicMock()
    selection.user_id = user_id
    selection.going_status = GoingStatus.INTERESTED
    selection.interested_reminder_sent_at = None

    mocker.patch(
        "app.services.push_notifications.showtime_crud.get_interested_reminder_candidates",
        return_value=[(selection, showtime)],
    )
    get_tokens = mocker.patch(
        "app.services.push_notifications.push_token_crud.get_push_tokens_for_users",
    )
    mocker.patch(
        "app.services.push_notifications.user_crud.get_users_by_ids",
        return_value=[
            mocker.MagicMock(
                id=user_id,
                email="friend@example.com",
                notify_on_interest_reminder=True,
                notify_channel_interest_reminder=NotificationChannel.EMAIL,
            )
        ],
    )
    send_messages = mocker.patch("app.services.push_notifications._send_expo_messages")
    send_email = mocker.patch(
        "app.services.push_notifications._send_email_notification",
        return_value=True,
    )

    sent_count = push_notifications.send_interested_showtime_reminders(
        session=session,
        now=now,
    )

    assert sent_count == 1
    assert selection.interested_reminder_sent_at == now
    get_tokens.assert_not_called()
    send_messages.assert_not_called()
    send_email.assert_called_once()
    session.commit.assert_called_once()


def test_handle_expo_results_removes_only_device_not_registered(
    mocker: MockerFixture,
) -> None:
    session = mocker.MagicMock()
    delete_token = mocker.patch(
        "app.services.push_notifications.push_token_crud.delete_push_token"
    )

    push_notifications._handle_expo_results(
        session=session,
        tokens=[
            "ExponentPushToken[invalid-creds]",
            "ExponentPushToken[device-not-registered]",
        ],
        results=[
            {"status": "error", "details": {"error": "InvalidCredentials"}},
            {"status": "error", "details": {"error": "DeviceNotRegistered"}},
        ],
    )

    delete_token.assert_called_once_with(
        session=session,
        token="ExponentPushToken[device-not-registered]",
    )
    session.commit.assert_called_once()


def test_handle_expo_results_does_not_remove_token_for_invalid_credentials(
    mocker: MockerFixture,
) -> None:
    session = mocker.MagicMock()
    delete_token = mocker.patch(
        "app.services.push_notifications.push_token_crud.delete_push_token"
    )

    push_notifications._handle_expo_results(
        session=session,
        tokens=["ExponentPushToken[invalid-creds-only]"],
        results=[{"status": "error", "details": {"error": "InvalidCredentials"}}],
    )

    delete_token.assert_not_called()
    session.commit.assert_not_called()
