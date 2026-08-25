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
class SeatAvailabilityLevel(str, Enum):
    """How full a screening is, as a handful of buckets rather than a number.

    Derived from `Showtime.seats_left` against `seats_capacity` — see
    `app.services.seat_availability.seat_availability_level`, which is the only
    place the cutoffs live. A showtime we have no usable reading for has no
    level at all (`None`), which is deliberately not a value here: "we don't
    know" must never be renderable as "it's fine".

    Declaration order is emptiest-first and is load-bearing: `SEAT_LEVEL_ORDER`
    below reads it to compare two levels, which is what lets a showtime's level
    ratchet upwards and never fall back.
    """

    EMPTY = "empty"
    SOME_TAKEN = "some_taken"
    BUSY = "busy"
    VERY_BUSY = "very_busy"
    LAST_FEW = "last_few"
    SOLD_OUT = "sold_out"


# Emptiest to fullest. Levels are compared by position here, never by value.
SEAT_LEVEL_ORDER: tuple[SeatAvailabilityLevel, ...] = tuple(SeatAvailabilityLevel)


def is_fuller_than(
    level: SeatAvailabilityLevel, other: SeatAvailabilityLevel | None
) -> bool:
    """Whether `level` is a busier bucket than `other` (None being emptiest)."""
    if other is None:
        return True
    return SEAT_LEVEL_ORDER.index(level) > SEAT_LEVEL_ORDER.index(other)


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
    # A showtime you were watching for a returned ticket has seats again.
    SEATS_RELEASED = "seats_released"
    # A showtime you marked interested in has nearly sold out.
    SEATS_RUNNING_OUT = "seats_running_out"


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
    TIP_SHOWN = "tip_shown"
    TIP_REACTED = "tip_reacted"


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


@unique
class UserReportReason(str, Enum):
    """Why a user is reporting another user.

    Scoped to what is actually possible in MiKiNO: there is no messaging or
    free-text between users, so reasons like harassment or bullying (which
    would need a channel to say something in) don't apply. What remains is
    what a username, a friend request, or an invite can actually do wrong.
    """

    OBJECTIONABLE_USERNAME = "objectionable_username"
    IMPERSONATION = "impersonation"
    REPEATED_UNWANTED_CONTACT = "repeated_unwanted_contact"
    SPAM = "spam"
    OTHER = "other"


@unique
class UserReportStatus(str, Enum):
    """Moderation state of a user-submitted report about another user.

    Mirrors `ShowtimeReportStatus` rather than sharing it: the two queues are
    triaged separately and nothing should make it possible to move a report
    about a person into a state that only means something for a screening.
    """

    OPEN = "open"
    RESOLVED = "resolved"
    DISMISSED = "dismissed"


@unique
class SocialProvider(str, Enum):
    """Third-party identity provider for social sign-in."""

    APPLE = "apple"
    GOOGLE = "google"


@unique
class LoginEmailSource(str, Enum):
    """Where a reserved, loginable email in `user_login_email` came from.

    Shares its GOOGLE/APPLE values with `SocialProvider` by design — `source =
    SocialProvider(...).value` needs no translation table. PRIMARY has no
    `SocialProvider` counterpart since it isn't provider-linked.
    """

    PRIMARY = "primary"
    GOOGLE = "google"
    APPLE = "apple"
