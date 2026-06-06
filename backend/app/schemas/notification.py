from datetime import datetime as DateTime
from typing import Literal

from sqlmodel import SQLModel

from .showtime import ShowtimeLoggedIn
from .user import UserPublic

__all__ = [
    "NotificationFeedItem",
    "NotificationFeedType",
    "NotificationSource",
]

# Which underlying table the feed item was read from. The client uses this to
# route dismiss/accept/decline actions to the correct endpoint.
NotificationSource = Literal["notification", "ping", "friend_request"]

# The five kinds of item the notification centre renders.
NotificationFeedType = Literal[
    "friend_showtime_match",
    "showtime_invite",
    "invite_response",
    "friend_request_received",
    "friend_request_accepted",
]


class NotificationFeedItem(SQLModel):
    """One merged, time-sorted entry in the notification centre.

    The three sources (the ``notification`` table, received ``ShowtimePing``
    rows, received ``FriendRequest`` rows) are normalised into this shape so the
    client renders a single feed. ``source`` + ``id`` identify the underlying
    row for actions.
    """

    source: NotificationSource
    # Identifies the underlying row for actions: the stringified int id for
    # ``notification``/``ping`` sources, and the sender's UUID for
    # ``friend_request`` (which is what accept/decline take).
    id: str
    type: NotificationFeedType
    created_at: DateTime
    seen_at: DateTime | None
    # The friend / sender / accepter involved (always present for current types).
    actor: UserPublic | None
    # Present for showtime-related types so a tap can open the showtime modal.
    showtime: ShowtimeLoggedIn | None
