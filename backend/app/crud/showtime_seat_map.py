"""Reads and writes of one showtime's per-seat taken map."""

from datetime import datetime

from sqlmodel import Session

from app.models.showtime_seat_map import ShowtimeSeatMap


def get_seat_map(*, session: Session, showtime_id: int) -> ShowtimeSeatMap | None:
    """This showtime's last per-seat reading, or None if it has never had one.

    None is the ordinary answer for most showtimes: only platforms that hand
    back a seat map produce these at all, and only showtimes the poller has
    actually read.
    """
    return session.get(ShowtimeSeatMap, showtime_id)


def record_seat_map(
    *,
    session: Session,
    showtime_id: int,
    taken: list[list[str]],
    checked_at: datetime,
) -> None:
    """Replace this showtime's seat map with the one just read.

    Always a full replacement, never a merge: the reading is a complete
    snapshot of the room, so a seat missing from it is free, and merging would
    make freed seats stick around as taken for ever.
    """
    existing = session.get(ShowtimeSeatMap, showtime_id)
    if existing is None:
        session.add(
            ShowtimeSeatMap(showtime_id=showtime_id, taken=taken, checked_at=checked_at)
        )
        return
    existing.taken = taken
    existing.checked_at = checked_at
    session.add(existing)
