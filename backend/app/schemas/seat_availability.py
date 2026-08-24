from datetime import datetime

from sqlmodel import SQLModel

from app.core.enums import SeatAvailabilityLevel

__all__ = [
    "ShowtimeSeatAvailabilityPublic",
    "SimulateSeatAvailability",
    "SoldOutWatchPublic",
]


class ShowtimeSeatAvailabilityPublic(SQLModel):
    """How full a screening is, and how much we can say about it.

    The same for everyone — this is a fact about the screening, not about who
    asked — which is what lets it be cached per showtime and prefetched for a
    whole list at once. A showtime with no usable reading is simply absent from
    the response rather than present with a null level, so the client never has
    to tell "empty" from "unknown".
    """

    showtime_id: int
    level: SeatAvailabilityLevel
    # Absent whenever the platform only says sold-out-or-not without a count,
    # so the detail line has to cope with a level and nothing else.
    seats_left: int | None = None
    seats_capacity: int | None = None
    checked_at: datetime | None = None
    # Whether asking to be told about a returned ticket is possible here at all
    # — a property of the screening (is it full, can its ticket shop be read),
    # not of the person asking, whose own eligibility comes from `UserMe`.
    watchable: bool = False


class SoldOutWatchPublic(SQLModel):
    showtime_id: int
    created_at: datetime


class SimulateSeatAvailability(SQLModel):
    """Made-up numbers for the superuser simulation hook (never production)."""

    seats_left: int | None = None
    seats_capacity: int | None = None
    # Clear the ratchet floor and every "already told them" stamp for this
    # showtime first, so the same crossing can be exercised more than once.
    reset: bool = False
