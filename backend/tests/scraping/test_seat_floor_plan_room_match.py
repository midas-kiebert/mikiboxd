"""A room's stored floor plan must belong to that room.

The room name comes from a cinema's agenda feed and the geometry from its
booking system. For an individual show those two can disagree — a screening
moved between rooms in one system and not the other — and production has
already stored KINO 1's 192-seat map under KINO 4 (111 seats) because the
ingest took the first candidate on trust.
"""

import json

import pytest

from app.scraping import seat_availability
from app.scraping.seat_availability import (
    SeatAvailabilityFetchError,
    fetch_eagerly_room_geometry,
    fetch_eagerly_seatplan_geometry,
)

BOOKING_HOST = "book.kinorotterdam.nl"
CINEMA_ID = "3"


class _StubResponse:
    def __init__(self, text: str) -> None:
        self.text = text

    def json(self):
        return json.loads(self.text)


def _seatplan_url(show_time_id: str) -> str:
    return (
        f"https://{BOOKING_HOST}/webservices/cinema_seatplans/getSeatPlanData"
        f"?cinema_id={CINEMA_ID}&mobile_device_id=00000000-0000-0000-0000-000000000000"
        f"&show_time_id={show_time_id}"
    )


def _seat(*, screen_name: str, seat_name: str, selectable: bool = True) -> dict:
    return {
        "screen_name": screen_name,
        "row_name": "1",
        "seat_name": seat_name,
        "position_left": 100,
        "position_top": 5,
        "width": 29,
        "height": 29,
        "seat_selectable": 1 if selectable else 0,
    }


def _plan(screen_name: str, seat_count: int) -> str:
    return json.dumps(
        {
            "resultCode": 0,
            "data": [
                _seat(screen_name=screen_name, seat_name=str(index + 1))
                for index in range(seat_count)
            ],
        }
    )


def _stub_plans(monkeypatch, plans: dict[str, str]) -> list[str]:
    """Serve one seat plan per show id; returns the show ids actually read."""
    requested: list[str] = []

    def _fake_get(url: str) -> _StubResponse:
        requested.append(url)
        if url not in plans:
            raise SeatAvailabilityFetchError(f"unexpected url {url}")
        return _StubResponse(plans[url])

    monkeypatch.setattr(seat_availability, "_get", _fake_get)
    return requested


def test_geometry_reports_the_booking_systems_own_room(monkeypatch) -> None:
    _stub_plans(monkeypatch, {_seatplan_url("130568"): _plan("KINO 4", 3)})
    geometry = fetch_eagerly_seatplan_geometry(
        booking_host=BOOKING_HOST, cinema_id=CINEMA_ID, show_time_id="130568"
    )
    assert geometry is not None
    assert geometry.screen_name == "KINO 4"
    assert len(geometry.seats) == 3
    # The screen name identifies the plan, it isn't per-seat data worth storing.
    assert "screen_name" not in geometry.seats[0]


def test_room_geometry_takes_the_first_agreeing_showtime(monkeypatch) -> None:
    requested = _stub_plans(monkeypatch, {_seatplan_url("130568"): _plan("KINO 4", 3)})
    seats, reason = fetch_eagerly_room_geometry(
        booking_host=BOOKING_HOST, room="KINO 4", candidates=[("130568", CINEMA_ID)]
    )
    assert seats is not None
    assert len(seats) == 3
    assert reason == ""
    assert len(requested) == 1


def test_room_geometry_skips_a_showtime_booked_in_another_room(monkeypatch) -> None:
    """The regression: the feed says KINO 4, the booking system says KINO 1."""
    _stub_plans(
        monkeypatch,
        {
            _seatplan_url("130568"): _plan("KINO 1", 192),
            _seatplan_url("126995"): _plan("KINO 4", 111),
        },
    )
    seats, reason = fetch_eagerly_room_geometry(
        booking_host=BOOKING_HOST,
        room="KINO 4",
        candidates=[("130568", CINEMA_ID), ("126995", CINEMA_ID)],
    )
    assert seats is not None
    assert len(seats) == 111
    assert reason == ""


def test_room_geometry_skips_a_showtime_with_no_seat_plan(monkeypatch) -> None:
    _stub_plans(
        monkeypatch,
        {
            _seatplan_url("130568"): json.dumps({"resultCode": 0, "data": []}),
            _seatplan_url("126995"): _plan("KINO 4", 111),
        },
    )
    seats, _ = fetch_eagerly_room_geometry(
        booking_host=BOOKING_HOST,
        room="KINO 4",
        candidates=[("130568", CINEMA_ID), ("126995", CINEMA_ID)],
    )
    assert seats is not None
    assert len(seats) == 111


def test_room_geometry_stores_nothing_when_no_showtime_agrees(monkeypatch) -> None:
    """Better a room with no floor plan than a room showing another's seats."""
    _stub_plans(
        monkeypatch,
        {
            _seatplan_url("130568"): _plan("KINO 1", 192),
            _seatplan_url("126995"): _plan("KINO 1", 192),
        },
    )
    seats, reason = fetch_eagerly_room_geometry(
        booking_host=BOOKING_HOST,
        room="KINO 4",
        candidates=[("130568", CINEMA_ID), ("126995", CINEMA_ID)],
    )
    assert seats is None
    assert "KINO 1" in reason


def test_room_geometry_bounds_how_many_showtimes_it_tries(monkeypatch) -> None:
    candidates = [(str(index), CINEMA_ID) for index in range(20)]
    requested = _stub_plans(
        monkeypatch,
        {_seatplan_url(show_id): _plan("KINO 1", 192) for show_id, _ in candidates},
    )
    seats, _ = fetch_eagerly_room_geometry(
        booking_host=BOOKING_HOST, room="KINO 4", candidates=candidates
    )
    assert seats is None
    assert len(requested) == seat_availability.MAX_ROOM_GEOMETRY_CANDIDATES


def test_room_geometry_reports_when_the_room_has_no_showtimes() -> None:
    seats, reason = fetch_eagerly_room_geometry(
        booking_host=BOOKING_HOST, room="KINO 4", candidates=[]
    )
    assert seats is None
    assert reason == "no showtimes in the feed"


@pytest.mark.parametrize("raw_screen_name", ["KINO 4", " KINO  4 "])
def test_room_geometry_matches_rooms_on_collapsed_whitespace(
    monkeypatch, raw_screen_name
) -> None:
    """`Showtime.room` is whitespace-collapsed, so the screen name must be too."""
    _stub_plans(monkeypatch, {_seatplan_url("130568"): _plan(raw_screen_name, 3)})
    seats, _ = fetch_eagerly_room_geometry(
        booking_host=BOOKING_HOST, room="KINO 4", candidates=[("130568", CINEMA_ID)]
    )
    assert seats is not None
