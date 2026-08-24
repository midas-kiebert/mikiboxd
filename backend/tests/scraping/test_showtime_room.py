"""Reading the room a showtime plays in, per scraper source.

Every source names its rooms differently and buries them in different markup;
these are trimmed from the real pages. Cinemas whose source has no room at all
(De Uitkijk's ladder API, Kriterion's numeric `theatre_id`, FC Hyena's events
list, Studio/K's UUID `hallId`) are covered by the availability poller instead
and have nothing to test here.
"""

from bs4 import BeautifulSoup
from bs4.element import Tag

from app.scraping.cinemas.amsterdam.lab111 import extract_room
from app.scraping.cinemas.amsterdam.rialto import select_course_value, select_text
from app.scraping.seat_availability import normalize_room

RIALTO_LOCATION_SELECTOR = "div.at-show-property.at-show-location"


def _row(markup: str) -> Tag:
    tag = BeautifulSoup(markup, "html.parser").find("tr")
    assert isinstance(tag, Tag)
    return tag


def test_lab111_reads_the_room_from_the_showtime_row() -> None:
    row = _row(
        '<tr class="day">'
        '<td><a href="https://tickets.lab111.nl/x/show/1299784">ma 24 aug 18:25</a></td>'
        '<td><span class="theatre_name">LAB 4</span></td>'
        '<td><a class="button tic" href="https://tickets.lab111.nl/x/show/1299784">Tickets</a></td>'
        "</tr>"
    )
    assert extract_room(row) == "LAB 4"


def test_lab111_row_without_a_room_is_none() -> None:
    row = _row('<tr class="day"><td><a href="/x">ma 24 aug 18:25</a></td></tr>')
    assert extract_room(row) is None


def test_rialto_de_pijp_reads_the_location_value_not_its_label() -> None:
    """Label and value are sibling divs that share the `at-show-location` class.

    Only the value carries `at-show-property`; selecting on the shared class
    alone would return the literal word "Locatie".
    """
    soup = BeautifulSoup(
        '<div class="at-show-property-container at-show-location">'
        '<div class="at-show-property-label at-show-location">Locatie</div>'
        '<div class="at-show-property at-show-location">ZAAL BOVEN</div>'
        "</div>",
        "html.parser",
    )
    assert select_text(soup, RIALTO_LOCATION_SELECTOR) == "ZAAL BOVEN"


def test_rialto_vu_reads_the_span_following_its_label() -> None:
    # The spec list is a flat run of sibling spans, not a table.
    soup = BeautifulSoup(
        '<div class="course-panel">'
        '<span class="course-label">Vanaf</span><span class="course-value">&euro; 6,50</span>'
        '<span class="course-label">Ruimte</span><span class="course-value">Zaal 8</span>'
        "</div>",
        "html.parser",
    )
    assert select_course_value(soup, "Ruimte") == "Zaal 8"
    assert select_course_value(soup, "Vanaf") == "€ 6,50"
    assert select_course_value(soup, "Ondertiteling") is None


def test_normalize_room_is_shared_by_every_source() -> None:
    # Eye writes a double space; the shop pages pad with newlines.
    assert normalize_room("Cinema  3") == "Cinema 3"
    assert normalize_room("\n  ZAAL BOVEN \n") == "ZAAL BOVEN"
    assert normalize_room("   ") is None
    assert normalize_room(None) is None


# --- Kriterion: theatre_id -> room name, one lookup per room ----------------


def _zelite_header_page(header: str) -> str:
    return f"<html><body><span id='show-starts-at'>{header}</span></body></html>"


def test_kriterion_names_each_theatre_id_from_one_lookup(monkeypatch) -> None:
    """shows.json numbers the rooms but never names them.

    One ticket-page fetch per distinct `theatre_id` is enough to name every
    showtime in that room — this must not fetch once per showtime.
    """
    from app.scraping.cinemas.amsterdam import kriterion

    pages = {
        1: _zelite_header_page("ma 24 augustus 2026, 16:30 - K 1"),
        2: _zelite_header_page("ma 24 augustus 2026, 17:10 - K 3"),
    }
    requested: list[int] = []

    class _StubResponse:
        def __init__(self, text: str) -> None:
            self.text = text

        def raise_for_status(self) -> None:
            return None

    def _fake_get(url: str, headers=None, timeout=None):
        show_id = int(url.rsplit("/", 1)[-1])
        requested.append(show_id)
        return _StubResponse(pages[show_id])

    monkeypatch.setattr(kriterion.requests, "get", _fake_get)

    shows = [
        kriterion.Show(id=1, production_id=100, theatre_id=6084, name="Film A"),
        kriterion.Show(id=1, production_id=100, theatre_id=6084, name="Film A"),
        kriterion.Show(id=2, production_id=101, theatre_id=6083, name="Film B"),
    ]
    room_names = kriterion.KriterionScraper._room_names_by_theatre_id(shows)

    assert room_names == {6084: "K 1", 6083: "K 3"}
    # Two rooms, one lookup each — the duplicate show for theatre 6084 is skipped
    # once its room is already known.
    assert requested == [1, 2]


def test_kriterion_falls_back_to_the_next_show_when_one_has_started(
    monkeypatch,
) -> None:
    """A show already in progress renders an empty header.

    The first candidate coming back blank must not give up on the room —
    it moves on to the next show in that theatre.
    """
    from app.scraping.cinemas.amsterdam import kriterion

    class _StubResponse:
        def __init__(self, text: str) -> None:
            self.text = text

        def raise_for_status(self) -> None:
            return None

    def _fake_get(url: str, headers=None, timeout=None):
        show_id = int(url.rsplit("/", 1)[-1])
        if show_id == 1:
            return _StubResponse("<html><body></body></html>")
        return _StubResponse(
            _zelite_header_page("ma 24 augustus 2026, 19:30 - K 2")
        )

    monkeypatch.setattr(kriterion.requests, "get", _fake_get)

    shows = [
        kriterion.Show(id=1, production_id=100, theatre_id=6085, name="Film A"),
        kriterion.Show(id=2, production_id=100, theatre_id=6085, name="Film A"),
    ]
    assert kriterion.KriterionScraper._room_names_by_theatre_id(shows) == {6085: "K 2"}


def test_kriterion_show_without_a_theatre_id_is_skipped() -> None:
    from app.scraping.cinemas.amsterdam import kriterion

    shows = [kriterion.Show(id=1, production_id=100, theatre_id=None, name="Film A")]
    assert kriterion.KriterionScraper._room_names_by_theatre_id(shows) == {}


# --- De Uitkijk: single-screen constant --------------------------------------


def test_uitkijk_has_exactly_one_room() -> None:
    from app.scraping.cinemas.amsterdam.uitkijk import ROOM_NAME

    assert ROOM_NAME == "De Grote Zaal"
