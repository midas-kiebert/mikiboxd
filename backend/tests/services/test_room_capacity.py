"""Capacity shared across every screening in a room."""

from datetime import datetime, timedelta

from app.models.showtime import Showtime
from app.scraping.seat_availability import SeatAvailability
from app.services.seat_availability import apply_reading

NOW = datetime(2026, 8, 24, 12, 0)


def _showtime(showtime_id: int, room: str | None = "LAB 1", **kwargs) -> Showtime:
    return Showtime(
        id=showtime_id,
        movie_id=1,
        cinema_id=7,
        datetime=NOW + timedelta(days=3),
        ticket_link=f"https://tickets.lab111.nl/order/{showtime_id}",
        room=room,
        **kwargs,
    )


def _read(showtime, seats_left, room_capacities, room="LAB 1") -> None:
    apply_reading(
        showtime=showtime,
        availability=SeatAvailability(seats_left, seats_left == 0, room, "z-elite"),
        now=NOW,
        room_capacities=room_capacities,
    )


def test_a_room_learns_from_one_screening_and_lends_it_to_the_next() -> None:
    """The whole point: a single showtime is read a handful of times, far too
    few for its own running max to converge, while the room it plays in is read
    hundreds of times a week across all its screenings."""
    room_capacities: dict[tuple[int, str], int] = {}

    busy_screening = _showtime(1)
    _read(busy_screening, 120, room_capacities)
    assert room_capacities[(7, "LAB 1")] == 120

    # A different screening in the same room, read once, while nearly empty.
    fresh_screening = _showtime(2)
    _read(fresh_screening, 118, room_capacities)
    # Without the shared number this would have read as a 118-seat house that
    # is completely empty; it is a 120-seat house with two seats gone.
    assert fresh_screening.seats_capacity == 120


def test_a_room_capacity_only_ever_grows() -> None:
    room_capacities = {(7, "LAB 1"): 120}
    reduced_screening = _showtime(3)
    _read(reduced_screening, 40, room_capacities)
    assert room_capacities[(7, "LAB 1")] == 120


def test_a_showtime_with_no_room_name_keeps_its_own_estimate() -> None:
    """Studio/K's halls are UUIDs and Cineville has no room field at all, so
    those showtimes must fall back to the per-showtime running max."""
    room_capacities: dict[tuple[int, str], int] = {(7, "LAB 1"): 120}
    roomless = _showtime(4, room=None)
    _read(roomless, 55, room_capacities, room=None)
    assert roomless.seats_capacity == 55
    assert room_capacities == {(7, "LAB 1"): 120}


def test_rooms_are_scoped_to_their_cinema() -> None:
    """Two cinemas both calling a room "Grote Zaal" must not share a number."""
    room_capacities: dict[tuple[int, str], int] = {}
    first = _showtime(5, room="Grote Zaal")
    _read(first, 300, room_capacities, room="Grote Zaal")

    second = _showtime(6, room="Grote Zaal")
    second.cinema_id = 9
    _read(second, 60, room_capacities, room="Grote Zaal")

    assert room_capacities[(7, "Grote Zaal")] == 300
    assert room_capacities[(9, "Grote Zaal")] == 60
    assert second.seats_capacity == 60
