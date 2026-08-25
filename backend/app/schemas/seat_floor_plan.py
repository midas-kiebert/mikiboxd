from sqlmodel import SQLModel

__all__ = ["SeatFloorPlanPublic", "SeatFloorPlanSeatPublic"]


class SeatFloorPlanSeatPublic(SQLModel):
    """One seat's position and status on a room's floor plan.

    Geometry (`position_left/top`, `width`, `height`) is the room's own,
    stored once and never refreshed. `taken`/`is_viewer_seat`/`friend_count`
    are computed fresh on every request — `taken` from a live read of the
    cinema's own seat map, the other two from this showtime's selections.
    """

    row_name: str
    seat_name: str
    position_left: int
    position_top: int
    width: int
    height: int
    # False for aisle gaps and other floor-plan filler that isn't a real seat.
    selectable: bool
    # None only when the live read failed or the cinema's booking host isn't
    # resolvable for this showtime — the seat's free/taken state is simply
    # unknown this request, not evidence either way.
    taken: bool | None
    is_viewer_seat: bool
    # How many visible friends self-reported this seat — not who, just how
    # many, since this is a "does anyone I know sit here" marker, not a
    # roster. Self-reported, so more than one friend landing on the same seat
    # is expected, not a conflict to resolve.
    friend_count: int = 0


class SeatFloorPlanPublic(SQLModel):
    """A room's seat map for one showtime, merged with live + personal state."""

    showtime_id: int
    room: str
    seats: list[SeatFloorPlanSeatPublic]
