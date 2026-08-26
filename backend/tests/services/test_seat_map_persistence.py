"""The seat map is polled, stored, and served — never fetched per sheet open.

Drawing the seat picker used to re-read the cinema's own booking system on
every open, which put the one screen most likely to be opened by many people
at once outside the very cadence that exists to keep that traffic bounded.
The per-seat state now rides along with the count it was always read
alongside, and the floor plan is served from what that reading wrote down.
"""

from datetime import datetime, timedelta

from sqlmodel import Session

from app.crud import showtime_seat_map as seat_map_crud
from app.models.cinema_room_floor_plan import CinemaRoomFloorPlan
from app.models.showtime import Showtime
from app.scraping.seat_availability import SeatAvailability
from app.services.seat_availability import apply_reading
from app.services.seat_floor_plan import get_seat_floor_plan

NOW = datetime(2026, 8, 24, 12, 0)
ROOM = "KINO 4"


def _reading(
    *, seats_left: int, taken: tuple[tuple[str, str], ...] | None
) -> SeatAvailability:
    return SeatAvailability(
        seats_left, seats_left == 0, ROOM, "eagerly", capacity=3, taken_seats=taken
    )


def _store_floor_plan(session: Session, *, cinema_id: int) -> None:
    """A three-seat room: 1/1 and 1/2 are real seats, the third is filler."""
    session.add(
        CinemaRoomFloorPlan(
            cinema_id=cinema_id,
            room=ROOM,
            seats=[
                {
                    "row_name": "1",
                    "seat_name": "1",
                    "position_left": 0,
                    "position_top": 0,
                    "width": 29,
                    "height": 29,
                    "selectable": True,
                },
                {
                    "row_name": "1",
                    "seat_name": "2",
                    "position_left": 40,
                    "position_top": 0,
                    "width": 29,
                    "height": 29,
                    "selectable": True,
                },
                {
                    "row_name": "1",
                    "seat_name": "",
                    "position_left": 80,
                    "position_top": 0,
                    "width": 29,
                    "height": 29,
                    "selectable": False,
                },
            ],
        )
    )
    session.commit()


def _polled_showtime(showtime_factory, db_transaction: Session) -> Showtime:
    showtime = showtime_factory(
        room=ROOM,
        datetime=NOW + timedelta(days=3),
        ticket_link="https://www.kinorotterdam.nl/tickets/126995",
    )
    db_transaction.commit()
    _store_floor_plan(db_transaction, cinema_id=showtime.cinema_id)
    return showtime


def test_a_reading_stores_the_seats_it_already_read(
    showtime_factory, db_transaction: Session
) -> None:
    showtime = _polled_showtime(showtime_factory, db_transaction)

    apply_reading(
        showtime=showtime,
        availability=_reading(seats_left=1, taken=(("1", "2"),)),
        now=NOW,
        session=db_transaction,
    )
    db_transaction.commit()

    stored = seat_map_crud.get_seat_map(
        session=db_transaction, showtime_id=showtime.id
    )
    assert stored is not None
    assert stored.taken == [["1", "2"]]
    # The map is exactly as fresh as the count it came in with.
    assert stored.checked_at == showtime.seats_checked_at


def test_a_later_reading_replaces_the_map_rather_than_merging(
    showtime_factory, db_transaction: Session
) -> None:
    """A freed seat has to disappear; merging would pin it as taken for ever."""
    showtime = _polled_showtime(showtime_factory, db_transaction)

    apply_reading(
        showtime=showtime,
        availability=_reading(seats_left=0, taken=(("1", "1"), ("1", "2"))),
        now=NOW,
        session=db_transaction,
    )
    apply_reading(
        showtime=showtime,
        availability=_reading(seats_left=1, taken=(("1", "1"),)),
        now=NOW + timedelta(hours=1),
        session=db_transaction,
    )
    db_transaction.commit()

    stored = seat_map_crud.get_seat_map(
        session=db_transaction, showtime_id=showtime.id
    )
    assert stored is not None
    assert stored.taken == [["1", "1"]]


def test_a_platform_without_a_seat_map_stores_nothing(
    showtime_factory, db_transaction: Session
) -> None:
    """Z-ELITE gives a count and no seats; that must not clear a stored map."""
    showtime = _polled_showtime(showtime_factory, db_transaction)

    apply_reading(
        showtime=showtime,
        availability=_reading(seats_left=1, taken=(("1", "2"),)),
        now=NOW,
        session=db_transaction,
    )
    apply_reading(
        showtime=showtime,
        availability=SeatAvailability(1, False, ROOM, "z-elite"),
        now=NOW + timedelta(hours=1),
        session=db_transaction,
    )
    db_transaction.commit()

    stored = seat_map_crud.get_seat_map(
        session=db_transaction, showtime_id=showtime.id
    )
    assert stored is not None
    assert stored.taken == [["1", "2"]]


def test_the_floor_plan_is_served_from_the_stored_reading(
    showtime_factory, db_transaction: Session
) -> None:
    showtime = _polled_showtime(showtime_factory, db_transaction)
    apply_reading(
        showtime=showtime,
        availability=_reading(seats_left=1, taken=(("1", "2"),)),
        now=NOW,
        session=db_transaction,
    )
    db_transaction.commit()

    plan = get_seat_floor_plan(
        session=db_transaction, showtime_id=showtime.id, viewer=None
    )
    assert plan is not None
    taken_by_seat = {seat.seat_name: seat.taken for seat in plan.seats}
    assert taken_by_seat["1"] is False
    assert taken_by_seat["2"] is True
    assert plan.seats_checked_at == showtime.seats_checked_at


def test_an_unpolled_showtime_leaves_every_seat_unknown(
    showtime_factory, db_transaction: Session
) -> None:
    """Never-read must read as "don't know", not as a room full of free seats."""
    showtime = _polled_showtime(showtime_factory, db_transaction)

    plan = get_seat_floor_plan(
        session=db_transaction, showtime_id=showtime.id, viewer=None
    )
    assert plan is not None
    assert plan.seats_checked_at is None
    assert all(seat.taken is None for seat in plan.seats)


def test_the_floor_plan_never_reads_a_ticket_shop(
    showtime_factory, db_transaction: Session, monkeypatch
) -> None:
    """The regression this whole change exists for."""
    showtime = _polled_showtime(showtime_factory, db_transaction)
    apply_reading(
        showtime=showtime,
        availability=_reading(seats_left=1, taken=(("1", "2"),)),
        now=NOW,
        session=db_transaction,
    )
    db_transaction.commit()

    def _explode(*args, **kwargs):
        raise AssertionError("the seat picker must not hit the booking system")

    monkeypatch.setattr("app.scraping.seat_availability._get", _explode)

    plan = get_seat_floor_plan(
        session=db_transaction, showtime_id=showtime.id, viewer=None
    )
    assert plan is not None
