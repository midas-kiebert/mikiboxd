"""What happened to an account while the app was closed — for the app's tips."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class ScreeningSummary(BaseModel):
    showtime_id: int
    movie_id: int
    movie_title: str
    poster_link: str | None
    cinema_name: str
    datetime: datetime


class AwayInvite(BaseModel):
    sender_id: UUID
    sender_name: str | None
    screening: ScreeningSummary


class AwayEventsPublic(BaseModel):
    # Invites received in the window to screenings that are still ahead,
    # soonest first.
    upcoming_invites: list[AwayInvite]
    # Invites received in the window whose screening has already started
    # without the user having looked at their invites in between (app or
    # website) — the ones they actually missed. Earliest screening first.
    missed_invites: list[AwayInvite]
    # Friend requests received in the window and still pending.
    friend_requests: int
    # Screenings the user is interested in that sold out in the window, soonest
    # first. Upcoming ones only: a sold-out screening that has already started
    # is nothing to act on.
    sold_out: list[ScreeningSummary]
