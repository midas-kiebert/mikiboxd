"""The running-max capacity model and the busyness levels derived from it."""

import pytest

from app.models.showtime import Showtime
from app.scraping.seat_availability import SeatAvailability
from app.services import seat_availability as seat_availability_service
from app.core.enums import SeatAvailabilityLevel
from app.services.seat_availability import _apply_reading, seat_availability_level


def _showtime() -> Showtime:
    return Showtime(
        id=1,
        movie_id=1,
        cinema_id=1,
        datetime=None,  # type: ignore[arg-type]
    )


def _read(showtime: Showtime, availability: SeatAvailability) -> None:
    _apply_reading(showtime=showtime, availability=availability)


def _zelite(seats_left: int | None, sold_out: bool | None, room: str | None = "LAB 1"):
    return SeatAvailability(seats_left, sold_out, room, "z-elite")


@pytest.mark.parametrize(
    "seats_left, seats_capacity, expected",
    [
        # Sold out is its own state, never the fullest ordinary one.
        (0, 128, SeatAvailabilityLevel.SOLD_OUT),
        # A handful of seats is the last few whatever the room's size — and
        # knowable even before any capacity has been learned.
        (6, 312, SeatAvailabilityLevel.LAST_FEW),
        (6, None, SeatAvailabilityLevel.LAST_FEW),
        # Above the flat floor, the fraction decides. Every boundary below is
        # the pair straddling it, so a moved cutoff fails here first.
        # 10% of 312 is 31.2.
        (31, 312, SeatAvailabilityLevel.LAST_FEW),
        (32, 312, SeatAvailabilityLevel.VERY_BUSY),
        # 40% of 312 is 124.8.
        (124, 312, SeatAvailabilityLevel.VERY_BUSY),
        (125, 312, SeatAvailabilityLevel.BUSY),
        # 75% of 312 is 234.
        (233, 312, SeatAvailabilityLevel.BUSY),
        (234, 312, SeatAvailabilityLevel.SOME_TAKEN),
        # Above the top cutoff, still the same bucket — SOME_TAKEN is now the
        # emptiest level there is, all the way to a full room.
        (312, 312, SeatAvailabilityLevel.SOME_TAKEN),
        # Above the flat floor with no capacity to compare against, there is
        # nothing honest to say — and "nothing" must not read as "some taken".
        (40, None, None),
        (40, 0, None),
        (None, 312, None),
    ],
)
def test_seat_availability_level(seats_left, seats_capacity, expected) -> None:
    assert (
        seat_availability_level(
            seats_left=seats_left, seats_capacity=seats_capacity
        )
        is expected
    )


def test_capacity_is_the_running_max_of_every_reading() -> None:
    showtime = _showtime()
    for seats_left in (120, 55, 4):
        _read(showtime, _zelite(seats_left, False))
    assert showtime.seats_left == 4
    assert showtime.seats_capacity == 120
    assert (
        seat_availability_level(
            seats_left=showtime.seats_left, seats_capacity=showtime.seats_capacity
        )
        is SeatAvailabilityLevel.LAST_FEW
    )


def test_capacity_survives_a_sold_out_reading() -> None:
    """Zero says nothing about how big the room is, so it must not shrink it."""
    showtime = _showtime()
    _read(showtime, _zelite(120, False))
    _read(showtime, _zelite(0, True))
    assert showtime.seats_left == 0
    assert showtime.seats_capacity == 120


def test_released_tickets_clear_a_stale_sold_out() -> None:
    """Eagerly reports status without a count.

    A showtime that sold out and then had tickets released must stop reading as
    zero, even though the new reading carries no number.
    """
    showtime = _showtime()
    _read(showtime, _zelite(0, True))
    assert showtime.seats_left == 0
    _read(showtime, SeatAvailability(None, False, None, "eagerly"))
    assert showtime.seats_left is None
    assert showtime.seats_capacity is None


def test_eagerly_sold_out_without_a_count_still_sets_zero() -> None:
    showtime = _showtime()
    _read(showtime, SeatAvailability(None, True, "Parisienzaal", "eagerly"))
    assert showtime.seats_left == 0
    assert showtime.room == "Parisienzaal"


def test_unknown_reading_leaves_the_last_known_numbers_alone() -> None:
    showtime = _showtime()
    _read(showtime, _zelite(55, False))
    _read(showtime, SeatAvailability(None, None, None, "z-elite"))
    assert showtime.seats_left == 55
    assert showtime.seats_capacity == 55


def test_exact_capacity_is_used_immediately_not_just_as_a_running_max() -> None:
    """Eagerly's seat map hands back the room's real total on the very first
    reading — no need to wait for several readings to converge on it."""
    showtime = _showtime()
    _read(showtime, SeatAvailability(71, False, "Parisienzaal", "eagerly", capacity=75))
    assert showtime.seats_capacity == 75


def test_exact_capacity_is_not_undercut_by_a_later_thinner_reading() -> None:
    showtime = _showtime()
    _read(showtime, SeatAvailability(71, False, "Parisienzaal", "eagerly", capacity=75))
    # A later reading from a platform that can't see the total (or a smaller
    # seats_left, e.g. the room filling up) must not shrink the known total.
    _read(showtime, _zelite(10, False))
    assert showtime.seats_capacity == 75


def test_exact_capacity_can_still_grow_from_a_later_exact_reading() -> None:
    showtime = _showtime()
    _read(showtime, SeatAvailability(71, False, "Parisienzaal", "eagerly", capacity=75))
    _read(showtime, SeatAvailability(80, False, "Parisienzaal", "eagerly", capacity=80))
    assert showtime.seats_capacity == 80


def test_manual_override_is_used_immediately(monkeypatch) -> None:
    """A room with no platform-reported total (Z-ELITE here) still gets its
    real capacity right away if it's been entered in the overrides file,
    rather than waiting for the running max to converge on it."""
    monkeypatch.setattr(
        seat_availability_service,
        "_capacity_overrides",
        lambda: {"lab111": {"LAB 1": 55}},
    )
    showtime = _showtime()
    _apply_reading(
        showtime=showtime,
        availability=_zelite(5, False, room="LAB 1"),
        cinema_key="lab111",
    )
    assert showtime.seats_left == 5
    assert showtime.seats_capacity == 55


def test_manual_override_is_not_undercut_by_a_later_reading(monkeypatch) -> None:
    monkeypatch.setattr(
        seat_availability_service,
        "_capacity_overrides",
        lambda: {"lab111": {"LAB 1": 55}},
    )
    showtime = _showtime()
    _apply_reading(
        showtime=showtime,
        availability=_zelite(50, False, room="LAB 1"),
        cinema_key="lab111",
    )
    _apply_reading(
        showtime=showtime,
        availability=_zelite(3, False, room="LAB 1"),
        cinema_key="lab111",
    )
    assert showtime.seats_capacity == 55


def test_manual_override_requires_a_matching_room_name(monkeypatch) -> None:
    """A mismatched room name (e.g. the override is stale, or the scraper's
    room text changed) is a silent miss, not an error — falls back to the
    running max like a cinema with no override at all."""
    monkeypatch.setattr(
        seat_availability_service,
        "_capacity_overrides",
        lambda: {"lab111": {"LAB 1": 55}},
    )
    showtime = _showtime()
    _apply_reading(
        showtime=showtime,
        availability=_zelite(5, False, room="LAB 4"),
        cinema_key="lab111",
    )
    assert showtime.seats_capacity == 5


def test_manual_override_requires_a_matching_cinema_key(monkeypatch) -> None:
    monkeypatch.setattr(
        seat_availability_service,
        "_capacity_overrides",
        lambda: {"lab111": {"LAB 1": 55}},
    )
    showtime = _showtime()
    _apply_reading(
        showtime=showtime,
        availability=_zelite(5, False, room="LAB 1"),
        cinema_key="de-uitkijk",
    )
    assert showtime.seats_capacity == 5


def test_platform_exact_capacity_beats_a_manual_override() -> None:
    """If a platform ever does hand back the real total, that's live ground
    truth and should win over a possibly-stale manually-entered number."""
    showtime = _showtime()
    _apply_reading(
        showtime=showtime,
        availability=SeatAvailability(71, False, "Parisienzaal", "eagerly", capacity=75),
        cinema_key="filmhallen",
    )
    assert showtime.seats_capacity == 75


def test_room_is_filled_in_from_the_reading_and_not_blanked() -> None:
    showtime = _showtime()
    _read(showtime, _zelite(55, False, room="LAB 1"))
    assert showtime.room == "LAB 1"
    # Tricket knows the hall only as a UUID, so it reports no room name.
    _read(showtime, SeatAvailability(91, False, None, "tricket"))
    assert showtime.room == "LAB 1"
