from datetime import datetime

from sqlmodel import SQLModel

from app.core.enums import ScreenSide

__all__ = ["SeatFloorPlanPublic", "SeatFloorPlanSeatPublic"]


class SeatFloorPlanSeatPublic(SQLModel):
    """One seat's position and status on a room's floor plan.

    Geometry (`position_left/top`, `width`, `height`) is the room's own,
    stored once and never refreshed. `taken` comes from the availability
    poller's last reading of this showtime, so it is exactly as fresh as the
    seat count shown next to it and no ticket shop is read to answer this;
    `is_viewer_seat`/`friend_count` are computed per request from this
    showtime's selections.
    """

    row_name: str
    seat_name: str
    position_left: int
    position_top: int
    width: int
    height: int
    # False for aisle gaps and other floor-plan filler that isn't a real seat.
    selectable: bool
    # None only when this showtime has never had a per-seat reading — it has
    # not been polled yet, or its platform reports counts without a seat map.
    # The seat's free/taken state is simply unknown, not evidence either way.
    taken: bool | None
    is_viewer_seat: bool
    # How many visible friends self-reported this seat — not who, just how
    # many, since this is a "does anyone I know sit here" marker, not a
    # roster. Self-reported, so more than one friend landing on the same seat
    # is expected, not a conflict to resolve.
    friend_count: int = 0


class SeatFloorPlanPublic(SQLModel):
    """A room's seat map for one showtime, merged with polled + personal state."""

    showtime_id: int
    # Null where the room has no name anyone publishes — most Ticketlab shops
    # identify a room by number internally and never print it. The plan is
    # still complete; it just has nothing to be called.
    room: str | None
    seats: list[SeatFloorPlanSeatPublic]
    # Which end of the geometry above to draw the screen at. Stored per room
    # because it cannot be worked out from the seats — row 1 is usually the
    # row nearest the screen, but Filmhuis Alkmaar numbers from the back, and
    # Cinecenter's own map puts the screen below every seat.
    screen_side: ScreenSide = ScreenSide.TOP
    # When the `taken` flags were read, so the client can say how old they are
    # rather than implying a seat map is live. None when no reading exists yet,
    # which is the same condition that leaves every `taken` at None.
    seats_checked_at: datetime | None = None
