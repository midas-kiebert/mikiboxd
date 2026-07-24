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
class VisibilityMode(str, Enum):
    """Who may see a user's attendance status for a showtime.

    Stored per showtime on ShowtimeVisibilitySetting.

    - ALL_FRIENDS: every friend you haven't opted out of sharing with.
    - INVITED_ONLY: nobody by default.

    Regardless of the mode, your status is always visible to friends you
    invited, friends who invited you, and friends co-invited by the same person
    who invited you.
    """

    ALL_FRIENDS = "ALL_FRIENDS"
    INVITED_ONLY = "INVITED_ONLY"


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
class SearchField(str, Enum):
    """Which attribute the movie search ``query`` is matched against.

    TITLE also matches ``original_title``; the others match arrays/related
    tables rather than a single Movie column — see ``apply_search_filter``.
    """

    TITLE = "title"
    DIRECTOR = "director"
    ACTOR = "actor"
    CINEMA = "cinema"
    FRIEND = "friend"


@unique
class Language(str, Enum):
    """Languages selectable in the language filter.

    Values are ISO-639-1 codes matching ``Movie.original_language`` and the
    codes found in ``Showtime.subtitles``.
    """

    DUTCH = "nl"
    ENGLISH = "en"


@unique
class NotificationChannel(str, Enum):
    """The delivery mechanism for a notification sent to a user."""

    PUSH = "push"  # Mobile push notification via FCM
    EMAIL = "email"


@unique
class DigestFrequency(str, Enum):
    """How often a user wants to receive the watchlist new-showtime email digest.

    DAILY sends every newly-available movie every day. WEEKLY_OR_URGENT holds
    new movies back for up to a week, but sends early if one of the pending
    showtimes is happening soon — see app/services/watchlist_digest.py.
    """

    DAILY = "daily"
    WEEKLY_OR_URGENT = "weekly_or_urgent"


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


@unique
class AnalyticsEventName(str, Enum):
    """Closed set of client/server-fired usage events recorded for the beta.

    Fired via POST /me/events from web/mobile (except LOGIN, which the login
    route records itself) and aggregated by app/services/analytics_dashboard.py.
    """

    LOGIN = "login"
    APP_OPEN = "app_open"
    FILTER_APPLIED = "filter_applied"
    PRESET_USED = "preset_used"
    INVITE_SENT = "invite_sent"
    NOTIFICATION_CLICKED = "notification_clicked"


@unique
class ShowtimeReportReason(str, Enum):
    """Why a user is flagging a showtime as wrong."""

    INCORRECT_MOVIE = "incorrect_movie"
    INCORRECT_TIME = "incorrect_time"
    DOES_NOT_EXIST = "does_not_exist"
    DUPLICATE = "duplicate"
    WRONG_SUBTITLES = "wrong_subtitles"
    OTHER = "other"


@unique
class ShowtimeReportStatus(str, Enum):
    """Moderation state of a user-submitted showtime report."""

    OPEN = "open"
    RESOLVED = "resolved"
    DISMISSED = "dismissed"
