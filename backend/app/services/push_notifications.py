from collections import defaultdict
from collections.abc import Iterable
from datetime import datetime, timedelta
from html import escape
from logging import getLogger
from uuid import UUID

import httpx
from sqlmodel import Session

from app.core.config import settings
from app.core.enums import GoingStatus, NotificationChannel
from app.crud import push_token as push_token_crud
from app.crud import showtime as showtime_crud
from app.crud import showtime_visibility as showtime_visibility_crud
from app.crud import user as user_crud
from app.models.showtime import Showtime
from app.models.showtime_selection import ShowtimeSelection
from app.utils import EmailDeliveryError, now_amsterdam_naive, send_email

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
ANDROID_PUSH_CHANNEL_ID = "heads-up"
SHOWTIME_PING_NOTIFICATION_CATEGORY_ID = "showtime-ping"
REMINDER_HORIZON = timedelta(hours=24)
REMINDER_MINIMUM_NOTICE = timedelta(hours=2)
REMINDER_MINIMUM_DELAY_AFTER_SELECTION = timedelta(hours=2)
ACTIVE_SHOWTIME_STATUSES = (GoingStatus.GOING, GoingStatus.INTERESTED)

logger = getLogger(__name__)


def _token_hint(token: str) -> str:
    if len(token) <= 16:
        return token
    return f"{token[:12]}...{token[-4:]}"


def _send_email_notification(*, email_to: str, subject: str, body: str) -> bool:
    if not settings.emails_enabled:
        logger.info(
            "Email notifications are disabled; skipping delivery to %s",
            email_to,
        )
        return False

    html_content = f"<p>{escape(body)}</p>"
    try:
        send_email(
            email_to=email_to,
            subject=subject,
            html_content=html_content,
        )
        return True
    except (AssertionError, EmailDeliveryError, Exception):
        logger.exception("Failed sending email notification to %s", email_to)
        return False


def _build_showtime_status_payload(
    *,
    actor_name: str,
    actor_id: UUID,
    showtime: Showtime,
    previous_status: GoingStatus,
    new_status: GoingStatus,
) -> tuple[str, str, dict] | None:
    if previous_status == GoingStatus.GOING and new_status != GoingStatus.GOING:
        title = f"{actor_name} is no longer going"
        return (
            title,
            showtime.movie.title,
            {
                "type": "showtime_status_removed",
                "showtimeId": showtime.id,
                "movieId": showtime.movie_id,
                "actorId": str(actor_id),
                "status": new_status.value,
                "previousStatus": previous_status.value,
            },
        )

    if (
        previous_status == GoingStatus.INTERESTED
        and new_status == GoingStatus.NOT_GOING
    ):
        title = f"{actor_name} is no longer interested"
        return (
            title,
            showtime.movie.title,
            {
                "type": "showtime_status_removed",
                "showtimeId": showtime.id,
                "movieId": showtime.movie_id,
                "actorId": str(actor_id),
                "status": new_status.value,
                "previousStatus": previous_status.value,
            },
        )

    if new_status in ACTIVE_SHOWTIME_STATUSES and previous_status != new_status:
        status_text = "going" if new_status == GoingStatus.GOING else "interested"
        title = f"{actor_name} is {status_text}"
        return (
            title,
            showtime.movie.title,
            {
                "type": "showtime_match",
                "showtimeId": showtime.id,
                "movieId": showtime.movie_id,
                "actorId": str(actor_id),
                "status": new_status.value,
                "previousStatus": previous_status.value,
            },
        )

    return None


def notify_friends_on_showtime_selection(
    *,
    session: Session,
    actor_id: UUID,
    showtime: Showtime,
    previous_status: GoingStatus,
    going_status: GoingStatus,
) -> None:
    if previous_status == going_status:
        return

    actor = user_crud.get_user_by_id(session=session, user_id=actor_id)
    if actor is None:
        return

    actor_name = actor.display_name or "A friend"
    payload = _build_showtime_status_payload(
        actor_name=actor_name,
        actor_id=actor_id,
        showtime=showtime,
        previous_status=previous_status,
        new_status=going_status,
    )
    if payload is None:
        return

    recipients = showtime_crud.get_friends_with_showtime_selection(
        session=session,
        showtime_id=showtime.id,
        friend_id=actor_id,
        statuses=list(ACTIVE_SHOWTIME_STATUSES),
    )
    if not recipients:
        return

    opted_in_recipients = [
        user
        for user in recipients
        if user.id != actor_id and user.notify_on_friend_showtime_match
    ]
    if not opted_in_recipients:
        return

    visible_recipients = [
        user
        for user in opted_in_recipients
        if showtime_visibility_crud.is_showtime_visible_to_viewer_for_ids(
            session=session,
            owner_id=actor_id,
            showtime_id=showtime.id,
            viewer_id=user.id,
        )
    ]
    if not visible_recipients:
        return

    title, body, data = payload
    push_recipient_ids = [
        user.id
        for user in visible_recipients
        if user.notify_channel_friend_showtime_match != NotificationChannel.EMAIL
    ]
    email_recipients = [
        user
        for user in visible_recipients
        if user.notify_channel_friend_showtime_match == NotificationChannel.EMAIL
    ]

    if push_recipient_ids:
        push_tokens = push_token_crud.get_push_tokens_for_users(
            session=session,
            user_ids=push_recipient_ids,
        )

        if push_tokens:
            messages = [
                {
                    "to": token.token,
                    "title": title,
                    "body": body,
                    "data": data,
                    "priority": "high",
                    "sound": "default",
                    "channelId": ANDROID_PUSH_CHANNEL_ID,
                }
                for token in push_tokens
            ]

            try:
                results = _send_expo_messages(messages)
            except Exception:
                logger.exception("Failed sending showtime status notifications")
            else:
                _handle_expo_results(
                    session=session,
                    tokens=[token.token for token in push_tokens],
                    results=results,
                )

    for recipient in email_recipients:
        _send_email_notification(
            email_to=recipient.email,
            subject=title,
            body=body,
        )


def notify_user_on_friend_request(
    *,
    session: Session,
    sender_id: UUID,
    receiver_id: UUID,
) -> None:
    sender = user_crud.get_user_by_id(session=session, user_id=sender_id)
    if sender is None:
        return
    receiver = user_crud.get_user_by_id(session=session, user_id=receiver_id)
    if receiver is None or not receiver.notify_on_friend_requests:
        return

    sender_name = sender.display_name or "Someone"
    subject = "New friend request"
    body = f"{sender_name} sent you a friend request"
    if receiver.notify_channel_friend_requests == NotificationChannel.EMAIL:
        _send_email_notification(
            email_to=receiver.email,
            subject=subject,
            body=body,
        )
        return

    push_tokens = push_token_crud.get_push_tokens_for_users(
        session=session,
        user_ids=[receiver_id],
    )
    if not push_tokens:
        return

    messages = [
        {
            "to": token.token,
            "title": subject,
            "body": body,
            "data": {
                "type": "friend_request_received",
                "senderId": str(sender_id),
            },
            "priority": "high",
            "sound": "default",
            "channelId": ANDROID_PUSH_CHANNEL_ID,
        }
        for token in push_tokens
    ]

    try:
        results = _send_expo_messages(messages)
    except Exception:
        logger.exception("Failed sending friend request notifications")
        return

    _handle_expo_results(
        session=session,
        tokens=[token.token for token in push_tokens],
        results=results,
    )


def notify_user_on_friend_request_accepted(
    *,
    session: Session,
    accepter_id: UUID,
    requester_id: UUID,
) -> None:
    accepter = user_crud.get_user_by_id(session=session, user_id=accepter_id)
    if accepter is None:
        return
    requester = user_crud.get_user_by_id(session=session, user_id=requester_id)
    if requester is None or not requester.notify_on_friend_requests:
        return

    accepter_name = accepter.display_name or "Someone"
    subject = "Friend request accepted"
    body = f"{accepter_name} accepted your friend request"
    if requester.notify_channel_friend_requests == NotificationChannel.EMAIL:
        _send_email_notification(
            email_to=requester.email,
            subject=subject,
            body=body,
        )
        return

    push_tokens = push_token_crud.get_push_tokens_for_users(
        session=session,
        user_ids=[requester_id],
    )
    if not push_tokens:
        return

    messages = [
        {
            "to": token.token,
            "title": subject,
            "body": body,
            "data": {
                "type": "friend_request_accepted",
                "accepterId": str(accepter_id),
            },
            "priority": "high",
            "sound": "default",
            "channelId": ANDROID_PUSH_CHANNEL_ID,
        }
        for token in push_tokens
    ]

    try:
        results = _send_expo_messages(messages)
    except Exception:
        logger.exception("Failed sending friend request accepted notifications")
        return

    _handle_expo_results(
        session=session,
        tokens=[token.token for token in push_tokens],
        results=results,
    )


def notify_user_on_showtime_ping(
    *,
    session: Session,
    sender_id: UUID,
    receiver_id: UUID,
    showtime: Showtime,
) -> None:
    sender = user_crud.get_user_by_id(session=session, user_id=sender_id)
    if sender is None:
        return
    receiver = user_crud.get_user_by_id(session=session, user_id=receiver_id)
    if receiver is None or not receiver.notify_on_showtime_ping:
        return

    sender_name = sender.display_name or "A friend"
    formatted_datetime = showtime.datetime.strftime("%a, %b %d at %H:%M")
    subject = f"{sender_name} pinged you"
    body = f"{showtime.movie.title} • {formatted_datetime}"
    if receiver.notify_channel_showtime_ping == NotificationChannel.EMAIL:
        _send_email_notification(
            email_to=receiver.email,
            subject=subject,
            body=body,
        )
        return

    push_tokens = push_token_crud.get_push_tokens_for_users(
        session=session,
        user_ids=[receiver_id],
    )
    if not push_tokens:
        return

    messages = [
        {
            "to": token.token,
            "title": subject,
            "body": body,
            "data": {
                "type": "showtime_ping",
                "senderId": str(sender_id),
                "showtimeId": showtime.id,
                "movieId": showtime.movie_id,
            },
            "priority": "high",
            "sound": "default",
            "channelId": ANDROID_PUSH_CHANNEL_ID,
            "categoryId": SHOWTIME_PING_NOTIFICATION_CATEGORY_ID,
        }
        for token in push_tokens
    ]

    try:
        results = _send_expo_messages(messages)
    except Exception:
        logger.exception("Failed sending showtime ping notification")
        return

    _handle_expo_results(
        session=session,
        tokens=[token.token for token in push_tokens],
        results=results,
    )


def send_interested_showtime_reminders(
    *,
    session: Session,
    now: datetime | None = None,
) -> int:
    reference_time = now or now_amsterdam_naive()
    candidates = showtime_crud.get_interested_reminder_candidates(
        session=session,
        now=reference_time,
        reminder_horizon=REMINDER_HORIZON,
        minimum_notice=REMINDER_MINIMUM_NOTICE,
        minimum_delay_after_selection=REMINDER_MINIMUM_DELAY_AFTER_SELECTION,
    )
    if not candidates:
        return 0

    candidates_by_user: dict[UUID, list[tuple[ShowtimeSelection, Showtime]]] = (
        defaultdict(list)
    )
    for selection, showtime in candidates:
        candidates_by_user[selection.user_id].append((selection, showtime))

    recipient_users = user_crud.get_users_by_ids(
        session=session,
        user_ids=list(candidates_by_user.keys()),
    )
    opted_in_user_ids = {
        user.id for user in recipient_users if user.notify_on_interest_reminder
    }
    if not opted_in_user_ids:
        return 0
    candidates_by_user = {
        user_id: user_candidates
        for user_id, user_candidates in candidates_by_user.items()
        if user_id in opted_in_user_ids
    }
    if not candidates_by_user:
        return 0

    recipients_by_id = {user.id: user for user in recipient_users}

    push_user_ids: list[UUID] = []
    for user_id in candidates_by_user.keys():
        recipient = recipients_by_id.get(user_id)
        if recipient is None:
            continue
        if recipient.notify_channel_interest_reminder == NotificationChannel.EMAIL:
            continue
        push_user_ids.append(user_id)
    token_by_user: dict[UUID, list[str]] = defaultdict(list)
    if push_user_ids:
        push_tokens = push_token_crud.get_push_tokens_for_users(
            session=session,
            user_ids=push_user_ids,
        )
        for push_token in push_tokens:
            token_by_user[push_token.user_id].append(push_token.token)

    push_messages: list[dict] = []
    push_message_tokens: list[str] = []
    reminded_selections: list[ShowtimeSelection] = []
    for user_id, user_candidates in candidates_by_user.items():
        recipient = recipients_by_id.get(user_id)
        if recipient is None:
            continue
        for selection, showtime in user_candidates:
            formatted_datetime = showtime.datetime.strftime("%a, %b %d at %H:%M")
            subject = "Reminder: showtime soon"
            body = f"{showtime.movie.title} • {formatted_datetime}"
            if recipient.notify_channel_interest_reminder == NotificationChannel.EMAIL:
                sent = _send_email_notification(
                    email_to=recipient.email,
                    subject=subject,
                    body=body,
                )
                if sent:
                    reminded_selections.append(selection)
                continue

            user_tokens = token_by_user.get(user_id)
            if not user_tokens:
                continue

            for token in user_tokens:
                push_messages.append(
                    {
                        "to": token,
                        "title": subject,
                        "body": body,
                        "data": {
                            "type": "showtime_interest_reminder",
                            "showtimeId": showtime.id,
                            "movieId": showtime.movie_id,
                            "status": selection.going_status.value,
                        },
                        "priority": "high",
                        "sound": "default",
                        "channelId": ANDROID_PUSH_CHANNEL_ID,
                    }
                )
                push_message_tokens.append(token)
            reminded_selections.append(selection)

    if push_messages:
        try:
            results = _send_expo_messages(push_messages)
        except Exception:
            logger.exception("Failed sending interested showtime reminders")
            return 0

        _handle_expo_results(
            session=session,
            tokens=push_message_tokens,
            results=results,
        )

    if not reminded_selections:
        return 0

    for selection in reminded_selections:
        selection.interested_reminder_sent_at = reference_time
        session.add(selection)
    session.commit()
    return len(reminded_selections)


def _send_expo_messages(messages: list[dict]) -> list[dict]:
    with httpx.Client(timeout=10) as client:
        response = client.post(EXPO_PUSH_URL, json=messages)
        response.raise_for_status()
        payload = response.json()
    return payload.get("data", [])


def _handle_expo_results(
    *,
    session: Session,
    tokens: list[str],
    results: Iterable[dict],
) -> None:
    invalid_tokens = []
    for token, result in zip(tokens, results, strict=False):
        if result.get("status") != "error":
            continue
        error = result.get("details", {}).get("error")
        message = result.get("message")

        if error == "DeviceNotRegistered":
            invalid_tokens.append(token)
            logger.info(
                "Removing Expo push token after DeviceNotRegistered: %s",
                _token_hint(token),
            )
            continue

        logger.warning(
            "Expo push delivery error for token %s: error=%s message=%s",
            _token_hint(token),
            error,
            message,
        )

    for token in invalid_tokens:
        push_token_crud.delete_push_token(session=session, token=token)

    if invalid_tokens:
        session.commit()
