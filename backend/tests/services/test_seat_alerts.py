"""The once-per-showtime "nearly sold out" and "sold out" notices."""

from uuid import uuid4

from pytest_mock import MockerFixture

from app.core.enums import GoingStatus, NotificationChannel, SeatAlertKind
from app.services import push_notifications


def _selection(mocker, *, user_id, going_status=GoingStatus.INTERESTED):
    return mocker.MagicMock(
        user_id=user_id,
        going_status=going_status,
        seat_alert_sent_at=None,
        sold_out_alert_sent_at=None,
    )


def test_only_selections_never_alerted_before_are_queried(
    mocker: MockerFixture,
) -> None:
    """The guard against a double send lives in the query itself, not just in
    what gets stamped afterwards — so a caller cannot bypass it by mistake."""
    session = mocker.MagicMock()
    get_candidates = mocker.patch(
        "app.services.push_notifications.showtime_crud.get_seat_alert_candidates",
        return_value=[],
    )

    push_notifications.send_seat_alerts(
        session=session, showtime_ids=[1, 2], kind=SeatAlertKind.NEARLY_SOLD_OUT
    )

    get_candidates.assert_called_once_with(
        session=session,
        showtime_ids=[1, 2],
        statuses=push_notifications.SEAT_ALERT_STATUSES,
        kind=SeatAlertKind.NEARLY_SOLD_OUT,
    )
    assert push_notifications.SEAT_ALERT_STATUSES == (GoingStatus.INTERESTED,)


def test_alerting_stamps_seat_alert_sent_at_so_it_cannot_repeat(
    mocker: MockerFixture,
) -> None:
    session = mocker.MagicMock()
    user_id = uuid4()
    showtime = mocker.MagicMock(id=1, movie_id=2)
    showtime.movie.title = "In the Mood for Love"
    showtime.cinema.name = "LAB111"
    selection = _selection(mocker, user_id=user_id)

    mocker.patch(
        "app.services.push_notifications.showtime_crud.get_seat_alert_candidates",
        return_value=[(selection, showtime)],
    )
    recipient = mocker.MagicMock(
        id=user_id,
        notify_on_seat_alert=True,
        notify_channel_seat_alert=NotificationChannel.PUSH,
    )
    mocker.patch(
        "app.services.push_notifications.user_crud.get_users_by_ids",
        return_value=[recipient],
    )
    token = mocker.MagicMock(token="ExponentPushToken[abc]")
    mocker.patch(
        "app.services.push_notifications.push_token_crud.get_push_tokens_for_users",
        return_value=[token],
    )
    mocker.patch(
        "app.services.push_notifications._send_expo_messages",
        return_value=[{"status": "ok"}],
    )
    mocker.patch("app.services.push_notifications._handle_expo_results")
    mocker.patch(
        "app.services.push_notifications.notification_crud.upsert_notification"
    )

    sent_count = push_notifications.send_seat_alerts(
        session=session,
        showtime_ids=[showtime.id],
        kind=SeatAlertKind.NEARLY_SOLD_OUT,
    )

    assert sent_count == 1
    assert selection.seat_alert_sent_at is not None
    session.commit.assert_called()


def test_opted_out_recipients_receive_nothing(
    mocker: MockerFixture,
) -> None:
    """Turning the preference off must not still fire a push. Not stamping
    `seat_alert_sent_at` here is safe rather than a re-send risk: the caller
    only ever passes showtime ids on the run that crosses the threshold, which
    happens once per showtime by construction (the level floor never falls)."""
    session = mocker.MagicMock()
    user_id = uuid4()
    showtime = mocker.MagicMock(id=1, movie_id=2)
    showtime.movie.title = "Movie"
    showtime.cinema.name = "Cinema"
    selection = _selection(mocker, user_id=user_id)

    mocker.patch(
        "app.services.push_notifications.showtime_crud.get_seat_alert_candidates",
        return_value=[(selection, showtime)],
    )
    recipient = mocker.MagicMock(id=user_id, notify_on_seat_alert=False)
    mocker.patch(
        "app.services.push_notifications.user_crud.get_users_by_ids",
        return_value=[recipient],
    )
    send_messages = mocker.patch("app.services.push_notifications._send_expo_messages")

    sent_count = push_notifications.send_seat_alerts(
        session=session,
        showtime_ids=[showtime.id],
        kind=SeatAlertKind.NEARLY_SOLD_OUT,
    )

    send_messages.assert_not_called()
    assert sent_count == 0
    assert selection.seat_alert_sent_at is None


def test_sold_out_kind_uses_its_own_preference_stamp_and_wording(
    mocker: MockerFixture,
) -> None:
    """The sold-out notice is not a second copy of the nearly-sold-out one with
    a different name — it reads `notify_on_sold_out`, stamps
    `sold_out_alert_sent_at`, and says "sold out" rather than "nearly"."""
    session = mocker.MagicMock()
    user_id = uuid4()
    showtime = mocker.MagicMock(id=1, movie_id=2)
    showtime.movie.title = "Perfect Days"
    showtime.cinema.name = "Eye"
    selection = _selection(mocker, user_id=user_id)

    get_candidates = mocker.patch(
        "app.services.push_notifications.showtime_crud.get_seat_alert_candidates",
        return_value=[(selection, showtime)],
    )
    # Opted out of the nearly-sold-out nudge but in on the sold-out notice: the
    # two preferences must be read independently.
    recipient = mocker.MagicMock(
        id=user_id,
        notify_on_seat_alert=False,
        notify_on_sold_out=True,
        notify_channel_sold_out=NotificationChannel.PUSH,
    )
    mocker.patch(
        "app.services.push_notifications.user_crud.get_users_by_ids",
        return_value=[recipient],
    )
    token = mocker.MagicMock(token="ExponentPushToken[abc]")
    mocker.patch(
        "app.services.push_notifications.push_token_crud.get_push_tokens_for_users",
        return_value=[token],
    )
    send_expo = mocker.patch(
        "app.services.push_notifications._send_expo_messages",
        return_value=[{"status": "ok"}],
    )
    mocker.patch("app.services.push_notifications._handle_expo_results")
    mocker.patch(
        "app.services.push_notifications.notification_crud.upsert_notification"
    )

    sent_count = push_notifications.send_seat_alerts(
        session=session, showtime_ids=[showtime.id], kind=SeatAlertKind.SOLD_OUT
    )

    get_candidates.assert_called_once_with(
        session=session,
        showtime_ids=[showtime.id],
        statuses=push_notifications.SEAT_ALERT_STATUSES,
        kind=SeatAlertKind.SOLD_OUT,
    )
    assert sent_count == 1
    assert selection.sold_out_alert_sent_at is not None
    assert selection.seat_alert_sent_at is None
    sent_message = send_expo.call_args.args[0][0]
    assert sent_message["title"] == "Perfect Days is sold out"
    assert sent_message["data"]["type"] == "sold_out"
