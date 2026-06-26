from collections.abc import Sequence
from typing import TYPE_CHECKING

from pydantic import BaseModel

from app.core.enums import GoingStatus, VisibilityMode
from app.models.showtime import ShowtimeBase

if TYPE_CHECKING:
    from .cinema import CinemaPublic
    from .movie import MovieInShowtime
    from .user import UserPublic


__all__ = [
    "ShowtimeLoggedIn",
    "ShowtimeInMovieLoggedIn",
    "CoInvitedFriendPublic",
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


class ShowtimeLoggedIn(ShowtimeBase):
    id: int
    movie: "MovieInShowtime"
    cinema: "CinemaPublic"
    friends_going: Sequence["UserPublic"]
    friends_interested: Sequence["UserPublic"]
    going: GoingStatus
    seat_row: str | None = None
    seat_number: str | None = None
    # Unique senders of the current user's active (non-dismissed) received pings
    # for this showtime, plus those pings' ids (used to dismiss the invite).
    invited_by: Sequence["UserPublic"] = []
    invite_ping_ids: Sequence[int] = []
    # Your friends who were also invited by someone who invited you (co-invitees),
    # excluding anyone you already invited yourself.
    co_invited_friends: Sequence["CoInvitedFriendPublic"] = []
    # Friends you invited who haven't responded going/interested yet (pending).
    pending_invited_friends: Sequence["UserPublic"] = []
    # Friends who have this movie watchlisted / watched on Letterboxd.
    friends_watchlisted: Sequence["UserPublic"] = []
    friends_watched: Sequence["UserPublic"] = []


# For responses inside of a Movie model
class ShowtimeInMovieLoggedIn(ShowtimeBase):
    id: int
    cinema: "CinemaPublic"
    friends_going: Sequence["UserPublic"]
    friends_interested: Sequence["UserPublic"]
    going: GoingStatus
    seat_row: str | None = None
    seat_number: str | None = None
    invited_by: Sequence["UserPublic"] = []
    invite_ping_ids: Sequence[int] = []
    co_invited_friends: Sequence["CoInvitedFriendPublic"] = []
    pending_invited_friends: Sequence["UserPublic"] = []
