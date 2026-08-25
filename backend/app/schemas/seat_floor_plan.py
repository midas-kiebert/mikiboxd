from sqlmodel import SQLModel

from app.schemas.user import UserPublic

__all__ = ["SeatFloorPlanPublic", "SeatFloorPlanSeatPublic"]


class SeatFloorPlanSeatPublic(SQLModel):
    """One seat's position and status on a room's floor plan.

    Geometry (`position_left/top`, `width`, `height`) is the room's own,
    stored once and never refreshed. `taken`/`is_viewer_seat`/`friend` are
    computed fresh on every request — `taken` from a live read of the
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
    friend: UserPublic | None = None


class SeatFloorPlanPublic(SQLModel):
    """A room's seat map for one showtime, merged with live + personal state."""

    showtime_id: int
    room: str
    seats: list[SeatFloorPlanSeatPublic]
