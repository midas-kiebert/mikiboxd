"""Per-room capacity reads and writes."""

from collections.abc import Iterable

from sqlmodel import Session, col, select

from app.models.cinema_room_capacity import CinemaRoomCapacity

# (cinema_id, room) -> largest seat count ever seen there.
RoomCapacityIndex = dict[tuple[int, str], int]


def get_room_capacities(
    *, session: Session, cinema_ids: Iterable[int]
) -> RoomCapacityIndex:
    """Every known room capacity for these cinemas, as a lookup.

    Loaded for a whole poll run at once — a per-showtime query here would make
    a capped batch of 60 readings cost 60 extra round-trips for a table that is
    a few hundred rows in total.
    """
    cinema_id_list = list(cinema_ids)
    if not cinema_id_list:
        return {}
    rows = session.exec(
        select(CinemaRoomCapacity).where(
            col(CinemaRoomCapacity.cinema_id).in_(cinema_id_list)
        )
    ).all()
    return {(row.cinema_id, row.room): row.seats_capacity for row in rows}


def record_room_capacity(
    *, session: Session, cinema_id: int, room: str, seats_capacity: int
) -> None:
    """Raise this room's known capacity, never lower it.

    A reading can only ever prove a room is *at least* this big; a smaller one
    proves nothing, and could be a screening sold at reduced capacity or a
    half-loaded seat map.
    """
    existing = session.get(CinemaRoomCapacity, (cinema_id, room))
    if existing is None:
        session.add(
            CinemaRoomCapacity(
                cinema_id=cinema_id, room=room, seats_capacity=seats_capacity
            )
        )
        return
    if seats_capacity <= existing.seats_capacity:
        return
    existing.seats_capacity = seats_capacity
    session.add(existing)
