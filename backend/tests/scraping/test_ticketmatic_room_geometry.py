"""Reading a Ticketmatic performance page's SVG seat plan for the floor-plan
ingest.

The same `<rect>` blocks the poller already reads for the seat count carry
each seat's position, so the geometry fetch is a plain re-fetch of one page.
"""

import pytest

from app.scraping import seat_availability as seat_availability_module
from app.scraping.seat_availability import fetch_ticketmatic_room_geometry

CONCORDIA_URL = "https://tickets.concordia.nl/mtTicket/performance/123"


def _page(*, room: str, seats: list[tuple[str, str, str, bool]] | None = None) -> str:
    """A performance page cut down to the room header and the seat SVG.

    `seats` is a list of (row, seat, id, available) tuples; omit for a
    general-admission room (no `<rect>` at all).
    """
    rects = "".join(
        f'<rect id="{seat_id}" class="seat" x="{i * 20}" y="0" width="18" '
        f'height="18" data-status="{"AVAILABLE" if available else "NOTAVAILABLE"}" '
        f'data-row="{row}" data-seat="{seat}"></rect>'
        for i, (row, seat, seat_id, available) in enumerate(seats or [])
    )
    return (
        "<html><body>"
        f"<div class='mtPerformance'><h1>Title</h1>"
        f"<span class='date'>x</span>"
        f"<span class='location'><i class='icon'></i>{room}</span></div>"
        f"<svg>{rects}</svg>"
        "</body></html>"
    )


@pytest.fixture
def serve_page(monkeypatch):
    def _serve(page: str):
        class _Response:
            text = page

        monkeypatch.setattr(seat_availability_module, "_get", lambda url: _Response())

    return _serve


def test_a_numbered_room_yields_a_seat_plan(serve_page) -> None:
    serve_page(
        _page(
            room="Filmzaal 2",
            seats=[("A", "1", "1", True), ("A", "2", "2", False)],
        )
    )

    geometry = fetch_ticketmatic_room_geometry(CONCORDIA_URL)

    assert geometry is not None
    assert geometry.room == "Filmzaal 2"
    assert geometry.seats == [
        {
            "row_name": "A",
            "seat_name": "1",
            "position_left": 0.0,
            "position_top": 0.0,
            "width": 18.0,
            "height": 18.0,
            "selectable": True,
        },
        {
            "row_name": "A",
            "seat_name": "2",
            "position_left": 20.0,
            "position_top": 0.0,
            "width": 18.0,
            "height": 18.0,
            "selectable": True,
        },
    ]


def test_a_general_admission_room_yields_no_geometry(serve_page) -> None:
    serve_page(_page(room="Zaal 1", seats=None))

    assert fetch_ticketmatic_room_geometry(CONCORDIA_URL) is None


def test_an_unrecognised_link_yields_no_geometry() -> None:
    assert (
        fetch_ticketmatic_room_geometry("https://tickets.example.com/mtTicket/performance/1")
        is None
    )
