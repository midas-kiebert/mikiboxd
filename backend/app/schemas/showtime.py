from collections.abc import Sequence
from typing import TYPE_CHECKING

from pydantic import BaseModel, computed_field

from app.core.enums import GoingStatus, VisibilityMode
from app.models.showtime import ShowtimeBase
from app.schemas.legacy_viewer_compat import LEGACY_VIEWER_FIELD
from app.schemas.seat_availability import ShowtimeSeatAvailabilityPublic

if TYPE_CHECKING:
    from .cinema import CinemaPublic
    from .movie import MovieInShowtime
    from .user import UserPublic, UserWithFriendStatus


__all__ = [
    "ShowtimePublic",
    "ShowtimeViewerState",
    "ShowtimeInMoviePublic",
    "ShowtimeInMovieViewerState",
    "CoInvitedFriendPublic",
    "NonFriendParticipantPublic",
]


class ShowtimeSelectionUpdate(BaseModel):
    going_status: GoingStatus
    seat_row: str | None = None
    seat_number: str | None = None
    # Optional per-showtime visibility mode applied alongside the status change
    # (e.g. when the first-time popup lets the user pick a mode for this showtime).
    visibility_mode: VisibilityMode | None = None


class CoInvitedFriendPublic(BaseModel):
    """A friend who was invited by the same person who invited you.

    `inviter` is whichever of your active inviters sent that friend their
    invite — used to attribute the friend in the "Invited" list ("Invited by
    <inviter>").
    """

    friend: "UserPublic"
    inviter: "UserPublic"


class NonFriendParticipantPublic(BaseModel):
    """A non-friend in the viewer's invite graph for a showtime (identity only,
    no going/interested status — the client offers a friend-request control
    instead).

    Attribution mirrors `CoInvitedFriendPublic`'s "Invited by <inviter>"
    convention, plus the two direct cases: `invited_by_you` (the viewer
    invited them) and `invited_you` (they invited the viewer). At most one of
    `invited_by_you`, `invited_you`, `inviter` is set.
    """

    user: "UserWithFriendStatus"
    invited_by_you: bool = False
    invited_you: bool = False
    inviter: "UserPublic | None" = None


class ShowtimeInMovieViewerState(BaseModel):
    """What a showtime means to the person who asked for it.

    Kept apart from the showtime itself because it is the one part of the
    response that is *not* the same for everyone: the screening is public, this
    is the requester's own relationship to it. Carried as `viewer` on the
    schemas below, where `None` means nobody was asking — see `app.core.viewer`.
    Nesting it rather than flattening it is what makes those two cases
    distinguishable at all: a flat `friends_going: []` cannot say whether the
    viewer has no friends going or whether there is no viewer.
    """

    going: GoingStatus
    seat_row: str | None = None
    seat_number: str | None = None
    friends_going: Sequence["UserPublic"] = []
    friends_interested: Sequence["UserPublic"] = []
    # Unique senders of the viewer's active (non-dismissed) received pings for
    # this showtime, plus those pings' ids (used to dismiss the invite).
    invited_by: Sequence["UserPublic"] = []
    invite_ping_ids: Sequence[int] = []
    # Your friends who were also invited by someone who invited you (co-invitees),
    # excluding anyone you already invited yourself.
    co_invited_friends: Sequence["CoInvitedFriendPublic"] = []
    # Friends you invited who haven't responded going/interested yet (pending).
    pending_invited_friends: Sequence["UserPublic"] = []
    # Everyone GOING/INTERESTED the viewer can see but isn't friends with —
    # friends-of-friends, and non-friends in a shared invite. Read off the
    # visibility grants themselves (see
    # `crud.showtime.get_visible_non_friends_for_showtime`) so that whatever
    # made a showtime visible always has a name to show for it. The field
    # names predate that widening. Carries friend-request status since these
    # are never the viewer's own friends: the client offers a "+" to send or
    # accept a request straight from here.
    friends_of_friends_going: Sequence["UserWithFriendStatus"] = []
    friends_of_friends_interested: Sequence["UserWithFriendStatus"] = []
    # Who can see the viewer's status on this screening — the mode in force,
    # whether they set it themselves or it comes from their default. Carried
    # here (rather than fetched per showtime by the client) so the sheet's mode
    # pill paints the instant it opens, from a list the client already has. It
    # is viewer state in the strictest sense: it is the *asker's* own setting,
    # which is why it sits here and not on the screening.
    visibility_mode: VisibilityMode | None = None


class ShowtimeViewerState(ShowtimeInMovieViewerState):
    """The full viewer state, for the showtime sheet.

    The extra fields cost queries that a list of rows does not pay for, which is
    why the two shapes differ rather than one carrying empty defaults — an empty
    list should mean "none", never "we didn't look".
    """

    # Friends who have this movie watchlisted / watched on Letterboxd.
    friends_watchlisted: Sequence["UserPublic"] = []
    friends_watched: Sequence["UserPublic"] = []
    # Non-friends in the same invite graph (direct/co-invited/chain) for this
    # showtime. Identity only, no going/interested status — the client shows
    # an inline friend-request control instead.
    non_friend_participants: Sequence["NonFriendParticipantPublic"] = []


class ShowtimePublic(ShowtimeBase):
    """A screening: which film, which cinema, when, and where to buy a ticket.

    Public in the literal sense — identical for everyone and served without a
    token. Anything that varies by who is asking lives under `viewer`.
    """

    id: int
    movie: "MovieInShowtime"
    cinema: "CinemaPublic"
    viewer: "ShowtimeViewerState | None" = None
    # How full the screening is, carried inline so a list can paint its
    # busyness badges in the same frame as the cards. Derived from this very
    # row (see `services.seat_availability.to_public`), so it costs nothing
    # extra here, and it saves the client the follow-up batch request whose
    # round trip is what used to make the badges appear a beat late.
    #
    # `None` keeps the same meaning as an absent entry in the batch response:
    # nothing to say about this screening, and there never will be.
    seat_availability: ShowtimeSeatAvailabilityPublic | None = None

    # --- LEGACY_VIEWER_FIELDS: delete this whole block with the shim ---
    @computed_field(deprecated=LEGACY_VIEWER_FIELD)  # type: ignore[prop-decorator]  # known mypy false positive: python/mypy#1362
    @property
    def going(self) -> GoingStatus:
        return self.viewer.going if self.viewer else GoingStatus.NOT_GOING

    @computed_field(deprecated=LEGACY_VIEWER_FIELD)  # type: ignore[prop-decorator]  # known mypy false positive: python/mypy#1362
    @property
    def seat_row(self) -> str | None:
        return self.viewer.seat_row if self.viewer else None

    @computed_field(deprecated=LEGACY_VIEWER_FIELD)  # type: ignore[prop-decorator]  # known mypy false positive: python/mypy#1362
    @property
    def seat_number(self) -> str | None:
        return self.viewer.seat_number if self.viewer else None

    @computed_field(deprecated=LEGACY_VIEWER_FIELD)  # type: ignore[prop-decorator]  # known mypy false positive: python/mypy#1362
    @property
    def friends_going(self) -> Sequence["UserPublic"]:
        return self.viewer.friends_going if self.viewer else []

    @computed_field(deprecated=LEGACY_VIEWER_FIELD)  # type: ignore[prop-decorator]  # known mypy false positive: python/mypy#1362
    @property
    def friends_interested(self) -> Sequence["UserPublic"]:
        return self.viewer.friends_interested if self.viewer else []

    @computed_field(deprecated=LEGACY_VIEWER_FIELD)  # type: ignore[prop-decorator]  # known mypy false positive: python/mypy#1362
    @property
    def invited_by(self) -> Sequence["UserPublic"]:
        return self.viewer.invited_by if self.viewer else []

    @computed_field(deprecated=LEGACY_VIEWER_FIELD)  # type: ignore[prop-decorator]  # known mypy false positive: python/mypy#1362
    @property
    def invite_ping_ids(self) -> Sequence[int]:
        return self.viewer.invite_ping_ids if self.viewer else []

    @computed_field(deprecated=LEGACY_VIEWER_FIELD)  # type: ignore[prop-decorator]  # known mypy false positive: python/mypy#1362
    @property
    def co_invited_friends(self) -> Sequence["CoInvitedFriendPublic"]:
        return self.viewer.co_invited_friends if self.viewer else []

    @computed_field(deprecated=LEGACY_VIEWER_FIELD)  # type: ignore[prop-decorator]  # known mypy false positive: python/mypy#1362
    @property
    def pending_invited_friends(self) -> Sequence["UserPublic"]:
        return self.viewer.pending_invited_friends if self.viewer else []

    @computed_field(deprecated=LEGACY_VIEWER_FIELD)  # type: ignore[prop-decorator]  # known mypy false positive: python/mypy#1362
    @property
    def friends_watchlisted(self) -> Sequence["UserPublic"]:
        return self.viewer.friends_watchlisted if self.viewer else []

    @computed_field(deprecated=LEGACY_VIEWER_FIELD)  # type: ignore[prop-decorator]  # known mypy false positive: python/mypy#1362
    @property
    def friends_watched(self) -> Sequence["UserPublic"]:
        return self.viewer.friends_watched if self.viewer else []

    @computed_field(deprecated=LEGACY_VIEWER_FIELD)  # type: ignore[prop-decorator]  # known mypy false positive: python/mypy#1362
    @property
    def non_friend_participants(self) -> Sequence["NonFriendParticipantPublic"]:
        return self.viewer.non_friend_participants if self.viewer else []

    # --- end LEGACY_VIEWER_FIELDS ---


# For responses inside of a Movie model
class ShowtimeInMoviePublic(ShowtimeBase):
    """A screening listed under a movie, so it carries no movie of its own."""

    id: int
    cinema: "CinemaPublic"
    viewer: "ShowtimeInMovieViewerState | None" = None
    # Same inline availability as `ShowtimePublic` — see its field.
    seat_availability: ShowtimeSeatAvailabilityPublic | None = None

    # --- LEGACY_VIEWER_FIELDS: delete this whole block with the shim ---
    @computed_field(deprecated=LEGACY_VIEWER_FIELD)  # type: ignore[prop-decorator]  # known mypy false positive: python/mypy#1362
    @property
    def going(self) -> GoingStatus:
        return self.viewer.going if self.viewer else GoingStatus.NOT_GOING

    @computed_field(deprecated=LEGACY_VIEWER_FIELD)  # type: ignore[prop-decorator]  # known mypy false positive: python/mypy#1362
    @property
    def seat_row(self) -> str | None:
        return self.viewer.seat_row if self.viewer else None

    @computed_field(deprecated=LEGACY_VIEWER_FIELD)  # type: ignore[prop-decorator]  # known mypy false positive: python/mypy#1362
    @property
    def seat_number(self) -> str | None:
        return self.viewer.seat_number if self.viewer else None

    @computed_field(deprecated=LEGACY_VIEWER_FIELD)  # type: ignore[prop-decorator]  # known mypy false positive: python/mypy#1362
    @property
    def friends_going(self) -> Sequence["UserPublic"]:
        return self.viewer.friends_going if self.viewer else []

    @computed_field(deprecated=LEGACY_VIEWER_FIELD)  # type: ignore[prop-decorator]  # known mypy false positive: python/mypy#1362
    @property
    def friends_interested(self) -> Sequence["UserPublic"]:
        return self.viewer.friends_interested if self.viewer else []

    @computed_field(deprecated=LEGACY_VIEWER_FIELD)  # type: ignore[prop-decorator]  # known mypy false positive: python/mypy#1362
    @property
    def invited_by(self) -> Sequence["UserPublic"]:
        return self.viewer.invited_by if self.viewer else []

    @computed_field(deprecated=LEGACY_VIEWER_FIELD)  # type: ignore[prop-decorator]  # known mypy false positive: python/mypy#1362
    @property
    def invite_ping_ids(self) -> Sequence[int]:
        return self.viewer.invite_ping_ids if self.viewer else []

    @computed_field(deprecated=LEGACY_VIEWER_FIELD)  # type: ignore[prop-decorator]  # known mypy false positive: python/mypy#1362
    @property
    def co_invited_friends(self) -> Sequence["CoInvitedFriendPublic"]:
        return self.viewer.co_invited_friends if self.viewer else []

    @computed_field(deprecated=LEGACY_VIEWER_FIELD)  # type: ignore[prop-decorator]  # known mypy false positive: python/mypy#1362
    @property
    def pending_invited_friends(self) -> Sequence["UserPublic"]:
        return self.viewer.pending_invited_friends if self.viewer else []

    # --- end LEGACY_VIEWER_FIELDS ---
