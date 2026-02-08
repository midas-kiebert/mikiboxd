from uuid import uuid4

from pytest_mock import MockerFixture

from app.core.enums import GoingStatus
from app.services import push_notifications


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
    )
    recipient_opted_out = mocker.MagicMock(
        id=recipient_opted_out_id,
        notify_on_friend_showtime_match=False,
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
    handle_results.assert_called_once()


def test_notify_friends_skips_when_no_opted_in_recipients(
    mocker: MockerFixture,
) -> None:
    session = mocker.MagicMock()
    showtime = mocker.MagicMock(id=111, movie_id=222, movie=mocker.MagicMock(title="Movie"))
    actor = mocker.MagicMock(display_name="Alex")
    recipient_opted_out = mocker.MagicMock(
        id=uuid4(),
        notify_on_friend_showtime_match=False,
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
        going_status=GoingStatus.GOING,
    )

    get_tokens.assert_not_called()
    send_messages.assert_not_called()


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
