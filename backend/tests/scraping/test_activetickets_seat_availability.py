"""Reading an ActiveTickets show page.

The platform sells two kinds of room through the same page, and the difference
is the whole shape of the answer: a numbered room inlines its entire seat plan
(so the count, the room's real total and the taken map all come from the one
GET the link already needs), while a free-seating room inlines no seats at all
and can only say whether the screening is sold out. Both name the room.

Nine Cineville cinemas run on it, split four free-seating (Rialto De Pijp, De
Balie, Cinebergen, Slieker) to five numbered.
"""

import json

import pytest

from app.scraping import seat_availability as seat_availability_module
from app.scraping.seat_availability import (
    ACTIVETICKETS_URL_PATTERN,
    SeatAvailabilityFetchError,
    fetch_activetickets_room_geometry,
    fetch_seat_availability,
    supports,
)

LUMEN_URL = "https://tickets.filmhuis-lumen.nl/nl-NL/Show/Details/500-Miles-24-sep-33176"
RIALTO_URL = "https://tickets-depijp.rialtofilm.nl/Show/Details/The-Invite-30-Aug-11926930"


def _seat(seat_id: int, row: str, seat: str, *, available: bool, blocked: bool = False):
    return {
        "Id": seat_id,
        "X": seat_id * 20,
        "Y": 0,
        "S": available,
        "B": blocked,
        "Rang": "12",
        "Description": f"Rij:  {row}, Stoel:  {seat}",
    }


def _page(show_id: int, *, room: str, sold_out: bool = False, seats=None) -> str:
    """A show page cut down to the one thing the reader looks at."""
    cart = {
        "TransactionId": 0,
        "Shows": [
            {
                "IsPrimaryShow": True,
                "ShowId": show_id,
                "Title": "A Film",
                "HasSeatMap": bool(seats),
                "WebSeatmapMode": 2 if seats else 0,
                "Location": room,
                "EditData": {
                    "Items": [{"Name": "Normaal ", "SoldOut": False}],
                    "Seats": seats or [],
                    "SoldOut": sold_out,
                    "WaitingListMode": False,
                },
            }
        ],
    }
    # Deliberately shaped like the real thing: the model sits inside a wider
    # <script> block, and braces and semicolons appear on both sides of it.
    return (
        "<html><body><script>\n"
        '    var alertDialogTitle = "Let op!";\n'
        f"    var jsonCart = {json.dumps(cart)};\n"
        "    ko.applyBindings(model);\n"
        "</script></body></html>"
    )


@pytest.fixture
def serve_page(monkeypatch):
    """Answer the one GET the reader makes with a canned page."""

    def _serve(page: str):
        class _Response:
            text = page

        monkeypatch.setattr(
            seat_availability_module, "_get", lambda url: _Response()
        )

    return _serve


# --- which links are ActiveTickets ------------------------------------------


def test_the_id_is_the_number_at_the_end_of_the_slug() -> None:
    """The slug is full of numbers ("...-30-Aug-11926930"); the last one wins."""
    match = ACTIVETICKETS_URL_PATTERN.match(RIALTO_URL)
    assert match is not None
    assert match.group(1) == "11926930"


def test_a_link_with_no_slug_and_a_link_with_a_locale_both_parse() -> None:
    """De Balie links straight to the id; the shop's own pages carry a locale
    segment that Cineville's links do not."""
    bare = ACTIVETICKETS_URL_PATTERN.match(
        "https://tickets.debalie.nl/Show/Details/11839294"
    )
    localised = ACTIVETICKETS_URL_PATTERN.match(LUMEN_URL)
    assert bare is not None and bare.group(1) == "11839294"
    assert localised is not None and localised.group(1) == "33176"


def test_the_same_path_on_an_unknown_host_is_not_supported() -> None:
    """`/Show/Details/<id>` is a shape, not a platform — the same lesson the
    Eagerly pattern had to learn."""
    assert supports("https://tickets.example.com/Show/Details/Foo-1234") is False


# --- numbered rooms ----------------------------------------------------------


def test_a_numbered_room_yields_count_capacity_and_the_taken_map(serve_page) -> None:
    serve_page(
        _page(
            33176,
            room="Zaal 1",
            seats=[
                _seat(1, "1", "11", available=True),
                _seat(2, "1", "10", available=True),
                _seat(3, "2", "4", available=False),
            ],
        )
    )

    availability = fetch_seat_availability(ticket_link=LUMEN_URL)

    assert availability.platform == "activetickets"
    assert availability.room == "Zaal 1"
    assert availability.seats_left == 2
    assert availability.capacity == 3
    assert availability.sold_out is False
    assert availability.taken_seats == (("2", "4"),)


def test_a_blocked_seat_is_taken_but_still_counts_towards_the_room(
    serve_page,
) -> None:
    """`B` is a decision about one screening — held back, broken, a reduced
    layout — and the room is the same size next week. Dropping it from capacity
    would make a reduced-capacity screening read fuller than it is; the running
    max already leans the other way and that is the safe direction."""
    serve_page(
        _page(
            33176,
            room="Zaal 1",
            seats=[
                _seat(1, "1", "1", available=True),
                _seat(2, "1", "2", available=False, blocked=True),
                _seat(3, "1", "3", available=True, blocked=True),
            ],
        )
    )

    availability = fetch_seat_availability(ticket_link=LUMEN_URL)

    assert availability.seats_left == 1
    assert availability.capacity == 3
    assert sorted(availability.taken_seats or ()) == [("1", "2"), ("1", "3")]


def test_a_room_with_nothing_free_reads_sold_out(serve_page) -> None:
    serve_page(
        _page(
            33176,
            room="Zaal 1",
            seats=[
                _seat(1, "1", "1", available=False),
                _seat(2, "1", "2", available=False, blocked=True),
            ],
        )
    )

    availability = fetch_seat_availability(ticket_link=LUMEN_URL)

    assert availability.seats_left == 0
    assert availability.sold_out is True
    assert availability.capacity == 2


def test_an_english_locale_names_seats_the_same_way(serve_page) -> None:
    seat = _seat(1, "3", "7", available=False)
    seat["Description"] = "Row: 3, Seat: 7"
    serve_page(_page(33176, room="Zaal 1", seats=[seat]))

    availability = fetch_seat_availability(ticket_link=LUMEN_URL)

    assert availability.taken_seats == (("3", "7"),)


def test_a_seat_we_cannot_name_still_counts_but_is_left_off_the_map(
    serve_page,
) -> None:
    """The stored floor plan matches on the row/seat pair, so a guess would file
    one seat's state under another's. The count is unaffected — the seat is
    plainly not free either way."""
    unnamed = _seat(2, "1", "2", available=False)
    unnamed["Description"] = "Loge"
    serve_page(
        _page(
            33176,
            room="Zaal 1",
            seats=[_seat(1, "1", "1", available=True), unnamed],
        )
    )

    availability = fetch_seat_availability(ticket_link=LUMEN_URL)

    assert availability.seats_left == 1
    assert availability.capacity == 2
    assert availability.taken_seats == ()


# --- free seating ------------------------------------------------------------


def test_a_free_seating_room_reports_the_flag_and_no_count(serve_page) -> None:
    """Rialto De Pijp, De Balie, Cinebergen and Slieker sell every room this
    way. There is no count to be had at any price — only sold out or not."""
    serve_page(_page(11926930, room="ZAAL ONDER", sold_out=True))

    availability = fetch_seat_availability(ticket_link=RIALTO_URL)

    assert availability.seats_left is None
    assert availability.sold_out is True
    assert availability.capacity is None
    assert availability.room == "ZAAL ONDER"


def test_a_free_seating_room_on_sale_says_so_rather_than_saying_nothing(
    serve_page,
) -> None:
    """`False`, not `None`: it is what lets `_apply_reading` clear a stored zero
    when a sold-out screening has tickets handed back, which is the whole point
    of watching one."""
    serve_page(_page(11926930, room="ZAAL MIDDEN ", sold_out=False))

    availability = fetch_seat_availability(ticket_link=RIALTO_URL)

    assert availability.sold_out is False
    assert availability.seats_left is None
    assert availability.room == "ZAAL MIDDEN"


# --- pages that don't say what we asked --------------------------------------


def test_a_screening_the_shop_no_longer_lists_reads_unknown(serve_page) -> None:
    """Moved, cancelled, or a stale id in the link. Unknown — which must not be
    reported as sold out, the same rule a failed fetch follows."""
    serve_page(_page(99999999, room="Zaal 1", sold_out=True))

    availability = fetch_seat_availability(ticket_link=LUMEN_URL)

    assert availability.is_known is False
    assert availability.sold_out is None


def test_a_page_without_the_view_model_raises_rather_than_reading_empty(
    serve_page,
) -> None:
    serve_page("<html><body>Onderhoud</body></html>")

    with pytest.raises(SeatAvailabilityFetchError):
        fetch_seat_availability(ticket_link=LUMEN_URL)


# --- floor-plan geometry ------------------------------------------------------


def test_a_numbered_room_yields_a_seat_plan(serve_page) -> None:
    serve_page(
        _page(
            33176,
            room="Zaal 1",
            seats=[
                _seat(1, "1", "11", available=True),
                _seat(2, "1", "10", available=True, blocked=True),
            ],
        )
    )

    geometry = fetch_activetickets_room_geometry(LUMEN_URL)

    assert geometry is not None
    assert geometry.room == "Zaal 1"
    assert geometry.seats == [
        {
            "row_name": "1",
            "seat_name": "11",
            "position_left": 20.0,
            "position_top": 0.0,
            "width": 18.0,
            "height": 18.0,
            "selectable": True,
        },
        {
            "row_name": "1",
            "seat_name": "10",
            "position_left": 40.0,
            "position_top": 0.0,
            "width": 18.0,
            "height": 18.0,
            "selectable": True,
        },
    ]


def test_seat_size_is_derived_from_the_rooms_own_grid_pitch(serve_page) -> None:
    """The payload never states a seat's size, only positions — nothing here
    may hardcode one bigger than a real room's pitch, the bug that rendered
    Lumen's seats bunched on top of each other with no gap at all."""

    def _positioned(seat_id: int, row: str, seat: str, *, x: int, y: int) -> dict:
        raw = _seat(seat_id, row, seat, available=True)
        raw["X"] = x
        raw["Y"] = y
        return raw

    serve_page(
        _page(
            33176,
            room="Zaal 1",
            seats=[
                _positioned(1, "1", "1", x=0, y=0),
                _positioned(2, "1", "2", x=10, y=0),
                _positioned(3, "2", "1", x=0, y=10),
            ],
        )
    )

    geometry = fetch_activetickets_room_geometry(LUMEN_URL)

    assert geometry is not None
    assert {seat["width"] for seat in geometry.seats} == {8.0}
    assert {seat["height"] for seat in geometry.seats} == {8.0}


def test_a_free_seating_room_yields_no_geometry(serve_page) -> None:
    """No `Seats` on the page means there is nothing to draw a plan from."""
    serve_page(_page(11926930, room="ZAAL ONDER", sold_out=False))

    assert fetch_activetickets_room_geometry(RIALTO_URL) is None


def test_a_screening_the_shop_no_longer_lists_yields_no_geometry(serve_page) -> None:
    serve_page(_page(99999999, room="Zaal 1", sold_out=True))

    assert fetch_activetickets_room_geometry(LUMEN_URL) is None


def test_an_unrecognised_link_yields_no_geometry() -> None:
    assert (
        fetch_activetickets_room_geometry("https://tickets.example.com/Show/Details/1")
        is None
    )
