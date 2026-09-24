"""One-click unsubscribe from one kind of notification email.

Every notification email carries a link that turns off the kind of
notification it is, for the user it was sent to, without signing in. The link
holds a signed token naming the user and the `notify_on_*` field; the page it
opens asks for one confirming click before anything changes, because mail
scanners open links on their own and a bare GET must not unsubscribe anyone.
"""

import uuid
from typing import NamedTuple

from sqlmodel import Session

from app.core.config import settings
from app.core.security import (
    generate_notification_unsubscribe_token,
    verify_notification_unsubscribe_token,
)
from app.crud import user as user_crud
from app.models.user import User


class _UnsubscribeGroup(NamedTuple):
    # How the link reads in the email and on the confirmation page.
    label: str
    # Every field the one choice covers. Seat availability is one row in both
    # clients (nearly sold out, sold out and returned tickets), so unsubscribing
    # from any of its emails turns off all three.
    fields: tuple[str, ...]


_SEAT_AVAILABILITY_FIELDS = (
    "notify_on_seat_alert",
    "notify_on_sold_out",
    "notify_on_tickets_available",
)

_GROUPS: dict[str, _UnsubscribeGroup] = {
    "notify_on_friend_showtime_match": _UnsubscribeGroup(
        "friend activity emails", ("notify_on_friend_showtime_match",)
    ),
    "notify_on_friend_requests": _UnsubscribeGroup(
        "friend request emails", ("notify_on_friend_requests",)
    ),
    "notify_on_showtime_ping": _UnsubscribeGroup(
        "invite emails", ("notify_on_showtime_ping",)
    ),
    "notify_on_invite_response": _UnsubscribeGroup(
        "invite response emails", ("notify_on_invite_response",)
    ),
    "notify_on_interest_reminder": _UnsubscribeGroup(
        "interest reminder emails", ("notify_on_interest_reminder",)
    ),
    "notify_on_showtime_reminder": _UnsubscribeGroup(
        "reminder emails from friends", ("notify_on_showtime_reminder",)
    ),
    **{
        field: _UnsubscribeGroup("seat availability emails", _SEAT_AVAILABILITY_FIELDS)
        for field in _SEAT_AVAILABILITY_FIELDS
    },
}


def unsubscribe_link(*, user_id: uuid.UUID, preference: str) -> tuple[str, str]:
    """The (link, link text) for one user's unsubscribe from one preference."""
    group = _GROUPS[preference]
    token = generate_notification_unsubscribe_token(
        user_id=str(user_id), preference=preference
    )
    link = (
        f"{settings.API_HOST}{settings.API_V1_STR}"
        f"/users/unsubscribe-notification?token={token}"
    )
    return link, f"Unsubscribe from {group.label}"


def describe(token: str) -> str | None:
    """What the token unsubscribes from, or None when it is not a valid link."""
    decoded = verify_notification_unsubscribe_token(token)
    if decoded is None or decoded[1] not in _GROUPS:
        return None
    return _GROUPS[decoded[1]].label


def unsubscribe(*, session: Session, token: str) -> str | None:
    """Turn the token's preference off. Returns its label, or None if invalid.

    An account that no longer exists is reported as done: there is nothing left
    to send to it, which is what the person clicking wanted.
    """
    decoded = verify_notification_unsubscribe_token(token)
    if decoded is None or decoded[1] not in _GROUPS:
        return None
    user_id, preference = decoded
    group = _GROUPS[preference]
    try:
        parsed_id = uuid.UUID(user_id)
    except ValueError:
        return None
    user: User | None = user_crud.get_user_by_id(session=session, user_id=parsed_id)
    if user is not None:
        for field in group.fields:
            setattr(user, field, False)
        session.add(user)
        session.commit()
    return group.label
