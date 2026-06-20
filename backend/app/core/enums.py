"""Application-wide enumerations.

All enums inherit from `str` so that their values serialize directly to strings
in JSON responses and can be used as string values in SQLAlchemy columns —
without any extra conversion step.

Using enums instead of plain strings for status fields gives you:
  - A closed set of valid values (typos are caught at runtime or by type checkers)
  - IDE autocompletion
  - A single source of truth — change the enum, the change propagates everywhere
"""

from enum import Enum, unique


@unique
class Environment(str, Enum):
    """Which deployment environment the app is running in.

    Values match the strings set via the ENVIRONMENT env var. Behaviour that
    differs between environments (Sentry, secret enforcement, etc.) should
    branch on this enum rather than on raw strings.
    """

    LOCAL = "local"
    STAGING = "staging"
    PRODUCTION = "production"


@unique
class GoingStatus(str, Enum):
    """Whether a user intends to attend a showtime.

    Stored on ShowtimeSelection rows and used in visibility calculations.
    """

    GOING = "GOING"
    NOT_GOING = "NOT_GOING"
    INTERESTED = "INTERESTED"


@unique
class TimeOfDay(str, Enum):
    """Coarse time-of-day bucket used for showtime filtering.

    Showtimes are bucketed into one of these values based on their start time,
    allowing users to filter by "evening showings" etc. without specifying exact
    hour ranges.
    """

    MORNING = "MORNING"
    AFTERNOON = "AFTERNOON"
    EVENING = "EVENING"
    NIGHT = "NIGHT"


@unique
class NotificationChannel(str, Enum):
    """The delivery mechanism for a notification sent to a user."""

    PUSH = "push"  # Mobile push notification via FCM
    EMAIL = "email"


@unique
class ShowtimePingSort(str, Enum):
    """Sort order options for the pings list endpoint."""

    PING_CREATED_AT = "ping_created_at"  # Most recently sent pings first
    SHOWTIME_DATETIME = "showtime_datetime"  # Soonest showtime first


@unique
class NotificationType(str, Enum):
    """Kind of event a stored notification-centre entry represents.

    Only events that are not already persisted as their own actionable entity
    live in the ``notification`` table — received invites are ``ShowtimePing``
    rows and received friend requests are ``FriendRequest`` rows. See the
    notification-centre feed for how the three sources are merged.
    """

    # A friend marked going/interested on a showtime you are also going to.
    FRIEND_SHOWTIME_MATCH = "friend_showtime_match"
    # Someone you invited responded by marking going/interested.
    INVITE_RESPONSE = "invite_response"
    # Someone accepted a friend request you sent.
    FRIEND_REQUEST_ACCEPTED = "friend_request_accepted"
