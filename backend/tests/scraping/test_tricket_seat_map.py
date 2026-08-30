"""Reading a Tricket seat map, and where the screen is.

Tricket is the only platform that states which end of a room's layout the
screen is at — its map draws the screen line itself — which is why this is the
one place a `screen_side` is derived rather than defaulted or hand-entered.

The map's SVG carries positions and seat ids but no seat names; the screening
resource carries names but no positions. Neither is usable alone.
"""

import pytest

from app.core.enums import ScreenSide
from app.scraping.seat_availability import (
    TRICKET_ROOM_NAMES,
    TRICKET_SEAT_MAP_HOSTS,
    parse_tricket_seating_map,
)

SEAT_IDS = [
    "8a0fa019-df97-4084-a386-63fe54b16e71",
    "a5ad170f-bc5b-4513-942c-7070f20cdc49",
    "9981b2e6-834e-4c4c-a5cb-ff2dd4f0f81e",
]

NAMED_SEATS = {
    SEAT_IDS[0]: {"row": "A", "seat": "1"},
    SEAT_IDS[1]: {"row": "A", "seat": "2"},
    SEAT_IDS[2]: {"row": "B", "seat": "1"},
}


def _seat_svg(seat_id: str, x: int, y: int) -> str:
    return (
        f'<g id="{seat_id}" class="seat">\n'
        f'    <svg x="{x}" y="{y}">\n'
        '        <use href="#seat-rect" class="rect" />\n'
        "    </svg>\n"
        "</g>"
    )


def _screen_svg(y: int) -> str:
    return (
        f'<svg x="5" y="{y}">\n'
        '    <svg width="90" height="15">\n'
        '        <text id="screen-title">SCREEN</text>\n'
        "    </svg>\n"
        '    <line class="screen-line" x1="5" y1="1" x2="85" y2="1" />\n'
        "</svg>"
    )


def _map(*, screen_y: int | None, seats: list[str] | None = None) -> str:
    body = seats if seats is not None else [
        _seat_svg(SEAT_IDS[0], 10, 5),
        _seat_svg(SEAT_IDS[1], 20, 5),
        _seat_svg(SEAT_IDS[2], 10, 15),
    ]
    return (
        '<svg version="1.1" viewBox="0 0 100 170">\n'
        "<defs>\n"
        '    <svg id="seat-rect" width="10" height="10" viewBox="0 0 30 30">\n'
        '        <rect x="2" y="2" width="26" height="26" />\n'
        "    </svg>\n"
        "</defs>\n"
        + "\n".join(body)
        + ("\n" + _screen_svg(screen_y) if screen_y is not None else "")
        + "\n</svg>"
    )


def test_positions_and_names_are_read_from_the_two_halves_together() -> None:
    parsed = parse_tricket_seating_map(_map(screen_y=145), NAMED_SEATS)

    assert parsed is not None
    _, seats = parsed
    assert [(s["row_name"], s["seat_name"]) for s in seats] == [
        ("A", "1"),
        ("A", "2"),
        ("B", "1"),
    ]
    assert seats[0]["position_left"] == 10
    assert seats[0]["position_top"] == 5
    # Taken from the map's own seat glyph, not assumed.
    assert seats[0]["width"] == 10
    assert seats[0]["height"] == 10
    assert all(seat["selectable"] for seat in seats)


def test_a_screen_below_every_seat_reads_as_bottom() -> None:
    """Cinecenter draws it there. This is the case the hardcoded top got wrong,
    and it is not inferable from the rows: row A is nearest the top here."""
    parsed = parse_tricket_seating_map(_map(screen_y=145), NAMED_SEATS)

    assert parsed is not None
    assert parsed[0] == ScreenSide.BOTTOM.value


def test_a_screen_above_every_seat_reads_as_top() -> None:
    parsed = parse_tricket_seating_map(_map(screen_y=0), NAMED_SEATS)

    assert parsed is not None
    assert parsed[0] == ScreenSide.TOP.value


def test_a_map_with_no_screen_line_falls_back_to_top() -> None:
    """The honest default, not a guess from the row numbering — that inference
    is exactly what gets Filmhuis Alkmaar backwards."""
    parsed = parse_tricket_seating_map(_map(screen_y=None), NAMED_SEATS)

    assert parsed is not None
    assert parsed[0] == ScreenSide.TOP.value


def test_a_seat_the_screening_does_not_name_is_dropped() -> None:
    """The floor plan matches a stored seat to a reading on its row/seat pair,
    so a seat with no name could never be matched and must not be drawn."""
    unknown = _seat_svg("11111111-2222-3333-4444-555555555555", 30, 5)
    parsed = parse_tricket_seating_map(
        _map(screen_y=145, seats=[_seat_svg(SEAT_IDS[0], 10, 5), unknown]),
        NAMED_SEATS,
    )

    assert parsed is not None
    assert [(s["row_name"], s["seat_name"]) for s in parsed[1]] == [("A", "1")]


def test_a_map_with_no_recognisable_seats_is_no_plan_at_all() -> None:
    assert parse_tricket_seating_map(_map(screen_y=145, seats=[]), NAMED_SEATS) is None


@pytest.mark.parametrize("host", TRICKET_SEAT_MAP_HOSTS)
def test_every_seat_map_host_is_one_we_can_name_rooms_for(host: str) -> None:
    """A stored floor plan is keyed by room name, and Tricket never gives one —
    the names come from `TRICKET_ROOM_NAMES`. A shop on the seat-map list with
    no names behind it would read maps it could not file anywhere."""
    assert host == "kassa.cinecenter.nl"
    assert len(TRICKET_ROOM_NAMES) == 4


def test_studio_k_is_not_on_the_seat_map_list() -> None:
    """Its map is decorative — the room is sold unreserved, which is why
    cinemas.yaml has it as `seating: free`. Drawing a picker from it would
    invite people to choose a seat nobody is keeping for them."""
    assert "kassa.studio-k.nu" not in TRICKET_SEAT_MAP_HOSTS
