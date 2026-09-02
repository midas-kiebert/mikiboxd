"""Reading a Ticketlab checkout page.

Fourteen small arthouse cinemas run the same `/shop/tickets-new.php` shop, and
the thing that makes them different from every other platform is that most of
them never say what a room is called: only Focus, Wenneker and Cinema
Middelburg put a "Zaal" row on the page. Cinema Oostereiland, De Drom,
Filmhuis Bussum, Fizi and Luxor Zutphen print film, date and time and nothing
else, which is why a room is identified by `util.seating.locationid` and the
name is treated as an optional label on top of it.

The other thing worth pinning down is the red alert box, which the shop uses
for "show not found", "online sale finished" and "online sale disabled" alike.
Treating all three as "nothing to read here" is what kept the room, and so the
seat plan, out of reach for every show whose sale window had shut.
"""

import json

import pytest

from app.scraping import seat_availability as seat_availability_module
from app.scraping.seat_availability import (
    TICKETLAB_URL_PATTERN,
    fetch_seat_availability,
    fetch_ticketlab_room_geometry,
    supports,
)

BUSSUM_URL = "https://tickets.filmhuisbussum.nl/shop/tickets-new.php?showid=42135"
WENNEKER_URL = "https://tickets.wennekercinema.nl/shop/tickets-new.php?showid=3971"
ARTISHOCK_URL = "https://tickets.artishocksoest.nl/shop/tickets-new.php?showid=1556"
OOSTEREILAND_URL = (
    "https://tickets.cinemaoostereiland.nl/shop/tickets-new.php?showid=49699"
)

_SALE_CLOSED = (
    '<div class="alert alert-danger" role="alert">'
    "Online kaartverkoop voor deze voorstelling is beëindigd.</div>"
)


def _seat(seat_id: int, row: str, seat: str, *, state: int, x: int = 0, y: int = 0):
    return {
        "id": seat_id,
        "row": row,
        "seat": seat,
        "description": f"Rij {row} stoel {seat}",
        "x": x,
        "y": y,
        "state": state,
        "flags": 0,
    }


def _room_row(name: str) -> str:
    return (
        '<div class="col-md-3"><h4 class="event-label"><small>Zaal</small></h4>'
        f'</div><div class="col-md-9"><h4 class="event-label">{name}</h4></div>'
    )


def _page(
    show_id: int,
    *,
    seats=None,
    location_id: int = 2,
    room: str | None = None,
    available_tickets: int | None = None,
    sale_closed: bool = False,
) -> str:
    """A checkout page cut down to the three things the reader looks at."""
    state = {"showid": show_id, "seated": bool(seats), "max_quantity": 10}
    util: dict = {"ticket_types": [], "seat_flags": {}}
    if seats is not None:
        util["seating"] = {"locationid": location_id, "seats": seats}
    settings = {"referer": "/shop/tickets-new.php", "seat_width": 32}
    available = (
        f'<input type="hidden" id="availabletickets" name="availabletickets" '
        f'value="{available_tickets}" />'
        if available_tickets is not None
        else ""
    )
    return (
        "<html><body>"
        + (_SALE_CLOSED if sale_closed else "")
        + (_room_row(room) if room else "")
        + available
        + "<script>\n"
        f"    state = {json.dumps(state)};\n"
        f"    util = {json.dumps(util)};\n"
        f"    settings = {json.dumps(settings)};\n"
        "</script></body></html>"
    )


@pytest.fixture
def serve_page(monkeypatch):
    """Answer the one GET the reader makes with a canned page."""

    def _serve(page: str):
        class _Response:
            text = page

        monkeypatch.setattr(seat_availability_module, "_get", lambda url: _Response())

    return _serve


# --- which links are Ticketlab ----------------------------------------------


def test_the_showid_query_parameter_is_the_id() -> None:
    match = TICKETLAB_URL_PATTERN.match(BUSSUM_URL)
    assert match is not None
    assert match.group(1) == "42135"


def test_the_same_path_on_an_unknown_host_is_not_supported() -> None:
    unknown = "https://tickets.example.com/shop/tickets-new.php?showid=1"
    assert supports(unknown) is False


# --- rooms that are never named ---------------------------------------------


def test_a_nameless_room_is_still_identified_by_its_location_id(serve_page) -> None:
    """The regression this file exists for: eleven of the fourteen shops print
    no room name, and keying on the name alone left them with no room, no
    stored floor plan and no seat map."""
    serve_page(
        _page(
            42135,
            location_id=2,
            seats=[
                _seat(1, "1", "1", state=2),
                _seat(2, "1", "2", state=4),
            ],
        )
    )

    reading = fetch_seat_availability(ticket_link=BUSSUM_URL)

    assert reading.room is None
    assert reading.room_key == "2"
    assert (reading.seats_left, reading.capacity) == (1, 2)
    assert reading.taken_seats == (("1", "2"),)


def test_a_named_room_reports_both_the_name_and_the_key(serve_page) -> None:
    serve_page(
        _page(
            3971,
            location_id=1,
            room="Zaal 1 grote zaal",
            seats=[_seat(1, "1", "1", state=2)],
        )
    )

    reading = fetch_seat_availability(ticket_link=WENNEKER_URL)

    assert reading.room == "Zaal 1 grote zaal"
    assert reading.room_key == "1"


def test_the_geometry_ingest_files_a_nameless_room_under_its_key(serve_page) -> None:
    serve_page(
        _page(
            42135,
            location_id=7,
            seats=[_seat(1, "1", "1", state=2, x=36, y=0)],
        )
    )

    geometry = fetch_ticketlab_room_geometry(BUSSUM_URL)

    assert geometry is not None
    assert (geometry.room_key, geometry.room) == ("7", None)
    assert geometry.seats == [
        {
            "row_name": "1",
            "seat_name": "1",
            "position_left": 36.0,
            "position_top": 0.0,
            "width": 32,
            "height": 32,
            "selectable": True,
        }
    ]


# --- free seating -----------------------------------------------------------


def test_a_free_seating_show_reports_the_running_count_and_no_room_key(
    serve_page,
) -> None:
    """No seat map means no `locationid` either — which is correct, since
    there is no seat plan for a room sold this way to be found."""
    serve_page(_page(1556, seats=None, available_tickets=32))

    reading = fetch_seat_availability(ticket_link=ARTISHOCK_URL)

    assert (reading.seats_left, reading.sold_out) == (32, False)
    assert reading.room_key is None


# --- the one red alert box, three meanings ----------------------------------


def test_a_closed_sale_drops_the_count_but_keeps_the_room(serve_page) -> None:
    """A shop that has stopped selling reports `availabletickets` as 0 whatever
    the room holds, so the count is worthless — but the seat map on the same
    page still says which room this is, and that is what the floor plan is
    looked up by."""
    serve_page(
        _page(
            49699,
            location_id=4,
            sale_closed=True,
            available_tickets=0,
            seats=[_seat(1, "1", "1", state=2)],
        )
    )

    reading = fetch_seat_availability(ticket_link=OOSTEREILAND_URL)

    assert (reading.seats_left, reading.sold_out) == (None, None)
    assert reading.room_key == "4"


def test_a_closed_sale_still_yields_room_geometry(serve_page) -> None:
    """A room's layout does not depend on whether one screening in it is still
    on sale, so the ingest reads it rather than moving on."""
    serve_page(
        _page(
            49699,
            location_id=4,
            sale_closed=True,
            seats=[_seat(1, "1", "1", state=2)],
        )
    )

    geometry = fetch_ticketlab_room_geometry(OOSTEREILAND_URL)

    assert geometry is not None
    assert geometry.room_key == "4"


def test_an_unresolved_showid_reports_nothing_at_all(serve_page) -> None:
    """No order form on the page is the one case with genuinely nothing to
    read — and it must not be mistaken for a sold-out house."""
    serve_page(f"<html><body>{_SALE_CLOSED}</body></html>")

    reading = fetch_seat_availability(ticket_link=BUSSUM_URL)

    assert reading.seats_left is None
    assert reading.sold_out is None
    assert reading.room_key is None
