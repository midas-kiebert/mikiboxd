from collections.abc import Iterable
from logging import getLogger
from uuid import UUID

import httpx
from sqlmodel import Session

from app.core.enums import GoingStatus
from app.crud import push_token as push_token_crud
from app.crud import showtime as showtime_crud
from app.crud import user as user_crud
from app.models.showtime import Showtime

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
ANDROID_PUSH_CHANNEL_ID = "heads-up"

logger = getLogger(__name__)


def _token_hint(token: str) -> str:
    if len(token) <= 16:
        return token
    return f"{token[:12]}...{token[-4:]}"


def notify_friends_on_showtime_selection(
    *,
    session: Session,
    actor_id: UUID,
    showtime: Showtime,
    going_status: GoingStatus,
) -> None:
    if going_status not in (GoingStatus.GOING, GoingStatus.INTERESTED):
        return

    actor = user_crud.get_user_by_id(session=session, user_id=actor_id)
    if actor is None:
        return

    recipients = showtime_crud.get_friends_with_showtime_selection(
        session=session,
        showtime_id=showtime.id,
        friend_id=actor_id,
        statuses=[GoingStatus.GOING, GoingStatus.INTERESTED],
    )
    if not recipients:
        return

    recipient_ids = [
        user.id
        for user in recipients
        if user.id != actor_id and user.notify_on_friend_showtime_match
    ]
    if not recipient_ids:
        return

    push_tokens = push_token_crud.get_push_tokens_for_users(
        session=session,
        user_ids=recipient_ids,
    )
    if not push_tokens:
        return

    actor_name = actor.display_name or "A friend"
    status_text = "going" if going_status == GoingStatus.GOING else "interested"
    title = f"{actor_name} is {status_text}"
    body = showtime.movie.title
    data = {
        "type": "showtime_match",
        "showtimeId": showtime.id,
        "movieId": showtime.movie_id,
        "actorId": str(actor_id),
        "status": going_status.value,
    }

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
        logger.exception("Failed sending showtime match notifications")
        return

    _handle_expo_results(
        session=session,
        tokens=[token.token for token in push_tokens],
        results=results,
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

    push_tokens = push_token_crud.get_push_tokens_for_users(
        session=session,
        user_ids=[receiver_id],
    )
    if not push_tokens:
        return

    sender_name = sender.display_name or "Someone"
    messages = [
        {
            "to": token.token,
            "title": "New friend request",
            "body": f"{sender_name} sent you a friend request",
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

    push_tokens = push_token_crud.get_push_tokens_for_users(
        session=session,
        user_ids=[requester_id],
    )
    if not push_tokens:
        return

    accepter_name = accepter.display_name or "Someone"
    messages = [
        {
            "to": token.token,
            "title": "Friend request accepted",
            "body": f"{accepter_name} accepted your friend request",
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
