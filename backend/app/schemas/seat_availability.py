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
    whole list at once.

    A showtime is absent from the response only when there is nothing to say
    about it *and never will be*: no reading, none pending, and a ticket shop
    nothing here can read. That absence is what the client hides the whole
    "Available seats" block on, so it has to mean "not a thing here", not
    "not known yet" — the two get very different treatment, and a row of
    dashes where an answer never appears is worse than no row at all.
    Everything else comes back present: with a level once one has been read,
    with `checking` while one is on its way, and with neither (but
    `trackable` set) for a screening whose count could be read and has not
    been.
    """

    showtime_id: int
    level: SeatAvailabilityLevel | None = None
    # Absent whenever the platform only says sold-out-or-not without a count,
    # so the detail line has to cope with a level and nothing else.
    seats_left: int | None = None
    seats_capacity: int | None = None
    checked_at: datetime | None = None
    # Whether asking to be told about a returned ticket is possible here at all
    # — a property of the screening (is it full, can its ticket shop be read),
    # not of the person asking, whose own eligibility comes from `UserMe`.
    watchable: bool = False
    # A reading is expected shortly: either an immediate best-effort read is in
    # flight, or the showtime is already due and the poller takes it on its next
    # tick, at most a minute away. Derived from the due time rather than stored,
    # so it needs no in-flight bookkeeping — anything that lands a reading
    # pushes the due time into the future, which is what turns this back off.
    #
    # It coexists with a level: a showtime being re-read still has its previous
    # number, and the client shows both ("31/312 · checking…") rather than
    # blanking a perfectly good answer while a fresher one is fetched.
    checking: bool = False
    # Whether a seat count can be read for this screening at all — i.e. whether
    # its ticket shop is one of the platforms `scraping.seat_availability` knows
    # how to read. False for most cinemas, and the client hides the availability
    # block outright for them rather than showing a permanent "unknown".
    #
    # Deliberately independent of whether anything *has* been read: a screening
    # holding an old reading from a ticket link that has since moved to a
    # platform we can't read still shows the number it has.
    trackable: bool = False
    # Whether the viewer can ask for a first reading by hand. True only for a
    # trackable screening that has never been read and has no read pending —
    # the same one-shot rule `services.seat_availability.should_check_immediately`
    # enforces, mirrored here so the button can disappear the moment it stops
    # being possible rather than on tap.
    can_request_check: bool = False


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
