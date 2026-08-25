"""The level floor: a screening's busyness never walks back down."""

from datetime import datetime, timedelta

from app.core.enums import SeatAvailabilityLevel
from app.models.showtime import Showtime
from app.scraping.seat_availability import SeatAvailability
from app.services.seat_availability import (
    LEVEL_FLOOR_CEILING,
    apply_reading,
    effective_seat_level,
)

NOW = datetime(2026, 8, 24, 12, 0)


def _showtime(**kwargs) -> Showtime:
    return Showtime(
        id=1,
        movie_id=1,
        cinema_id=1,
        datetime=NOW + timedelta(days=3),
        ticket_link="https://tickets.lab111.nl/order/1",
        **kwargs,
    )


def _read(showtime: Showtime, seats_left: int | None, **kwargs) -> bool:
    return apply_reading(
        showtime=showtime,
        availability=SeatAvailability(
            seats_left, seats_left == 0, "LAB 1", "z-elite"
        ),
        now=NOW,
        **kwargs,
    )


def test_level_does_not_fall_when_seats_free_up() -> None:
    """The case that motivates the floor: ten tickets come back and the level
    would otherwise drop a tier and later climb it again, notifying twice."""
    showtime = _showtime(seats_capacity=100)
    _read(showtime, 5)
    assert effective_seat_level(showtime) is SeatAvailabilityLevel.LAST_FEW

    # 15 of 100 free reads as very_busy on its own; the floor holds it.
    _read(showtime, 15)
    assert showtime.seats_left == 15
    assert effective_seat_level(showtime) is SeatAvailabilityLevel.LAST_FEW


def test_level_rises_when_capacity_grows() -> None:
    """The running-max estimate under-reads a room until a bigger number turns
    up, which makes a screening look emptier than it is. Learning the room's
    real size corrects that upwards, and the floor — which only ever stops a
    level falling — must not stand in the way."""
    showtime = _showtime()
    _read(showtime, 40)
    # 40 seats and no capacity yet: as far as we know the room is 40 and empty.
    assert showtime.seats_capacity == 40
    assert effective_seat_level(showtime) is SeatAvailabilityLevel.EMPTY

    # The room turns out to be far bigger than this screening had revealed, so
    # the same 40 seats are 10% of it, not all of it.
    room_capacities = {(1, "LAB 1"): 400}
    _read(showtime, 40, room_capacities=room_capacities)
    assert showtime.seats_capacity == 400
    assert effective_seat_level(showtime) is SeatAvailabilityLevel.VERY_BUSY


def test_level_still_rises() -> None:
    showtime = _showtime(seats_capacity=100)
    _read(showtime, 90)
    assert effective_seat_level(showtime) is SeatAvailabilityLevel.EMPTY
    _read(showtime, 60)
    assert effective_seat_level(showtime) is SeatAvailabilityLevel.SOME_TAKEN
    _read(showtime, 45)
    assert effective_seat_level(showtime) is SeatAvailabilityLevel.BUSY
    _read(showtime, 20)
    assert effective_seat_level(showtime) is SeatAvailabilityLevel.VERY_BUSY


def test_sold_out_is_not_pinned_by_the_floor() -> None:
    """The one state that genuinely reverses. A screening you can buy a seat
    for must never still read "Sold out"."""
    showtime = _showtime(seats_capacity=100)
    _read(showtime, 0)
    assert effective_seat_level(showtime) is SeatAvailabilityLevel.SOLD_OUT
    assert showtime.seats_level_floor is LEVEL_FLOOR_CEILING

    _read(showtime, 3)
    assert effective_seat_level(showtime) is SeatAvailabilityLevel.LAST_FEW


def test_alert_crossing_fires_exactly_once() -> None:
    showtime = _showtime(seats_capacity=100)
    assert _read(showtime, 40) is False
    assert _read(showtime, 5) is True
    # Back above the threshold and down again: the floor already carries it.
    assert _read(showtime, 20) is False
    assert _read(showtime, 4) is False
    assert _read(showtime, 0) is False


def test_alert_crossing_fires_on_a_jump_straight_to_sold_out() -> None:
    showtime = _showtime(seats_capacity=100)
    assert _read(showtime, 40) is False
    assert _read(showtime, 0) is True


def test_an_unreadable_reading_neither_lowers_the_floor_nor_re_alerts() -> None:
    showtime = _showtime(seats_capacity=100)
    assert _read(showtime, 5) is True
    # Eagerly-style "on sale, count unknown" clears seats_left entirely.
    crossed = apply_reading(
        showtime=showtime,
        availability=SeatAvailability(None, False, None, "eagerly"),
        now=NOW,
    )
    assert crossed is False
    assert showtime.seats_left is None
    assert effective_seat_level(showtime) is SeatAvailabilityLevel.LAST_FEW
