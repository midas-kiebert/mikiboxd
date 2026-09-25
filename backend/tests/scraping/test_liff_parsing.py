"""LIFF (liff.nl WordPress API) parsing helpers.

The scraper is built with `__new__` and its cinema ids set by hand, so no
database lookup or network request happens.
"""

from datetime import datetime

import pytest

from app.scraping.festivals import liff

FESTIVAL_ID = 9001
TRIANON_ID = 9002
KIJKHUIS_ID = 9003

TODAY = datetime(2027, 10, 1)
LOCATIONS = {5: "Trianon 2", 6: "Kijkhuis 1", 7: "Het Nieuwe Buurthuis"}
FILMS = {
    11: {"id": 11, "acf": {"subTitle": None}},
    12: {"id": 12, "acf": {"movieCancelled": "true"}},
}


def _scraper(cinema_id_by_key: dict[str, int] | None = None) -> liff.LIFFScraper:
    scraper = liff.LIFFScraper.__new__(liff.LIFFScraper)
    scraper.cinema_id = FESTIVAL_ID
    scraper.cinema_id_by_key = (
        {"trianon": TRIANON_ID, "kijkhuis": KIJKHUIS_ID}
        if cinema_id_by_key is None
        else cinema_id_by_key
    )
    return scraper


def _show(
    *,
    date: str | None = "20271020",
    start: str | None = "20:00",
    end: str | None = "21:45",
    film: object = 11,
    location: object = 5,
    cancelled: object = None,
    external_link: object = None,
    show_key: object = None,
    link: str | None = "https://www.liff.nl/shows/mouse/",
    title: str = "Mouse nl",
) -> dict:
    acf: dict = {
        "schedule": {"date": date, "start_time": start, "end_time": end},
        "film": film,
        "location": location,
    }
    if cancelled is not None:
        acf["showCancelled"] = cancelled
    if external_link is not None:
        acf["external_link_ticket_button"] = external_link
    if show_key is not None:
        acf["showCustomKey"] = show_key
    return {"id": 1, "link": link, "title": {"rendered": title}, "acf": acf}


def _parse(show: dict, *, today: datetime = TODAY):
    return _scraper()._parse_show(
        show, location_names=LOCATIONS, films=FILMS, today=today
    )


# --------------------------------------------------------------------------
# _parse_show
# --------------------------------------------------------------------------


def test_parse_show_reads_basic_fields() -> None:
    parsed = _parse(_show())

    assert parsed is not None
    assert parsed.film_id == 11
    assert parsed.title == "Mouse"
    assert parsed.start == datetime(2027, 10, 20, 20, 0)
    assert parsed.end == datetime(2027, 10, 20, 21, 45)
    assert parsed.location_name == "Trianon 2"


@pytest.mark.parametrize("cancelled", [True, "true", "True"])
def test_parse_show_skips_cancelled_shows(cancelled) -> None:
    assert _parse(_show(cancelled=cancelled)) is None


@pytest.mark.parametrize("cancelled", [False, "false", ""])
def test_parse_show_keeps_shows_not_cancelled(cancelled) -> None:
    assert _parse(_show(cancelled=cancelled)) is not None


def test_parse_show_skips_show_whose_film_is_cancelled() -> None:
    assert _parse(_show(film=12)) is None


def test_parse_show_skips_past_shows() -> None:
    assert _parse(_show(date="20270930", start="23:00")) is None


def test_parse_show_keeps_show_later_today() -> None:
    parsed = _parse(_show(date="20271001", start="10:00", end="11:30"))

    assert parsed is not None
    assert parsed.start == datetime(2027, 10, 1, 10, 0)


@pytest.mark.parametrize(
    ("date", "start"), [(None, "20:00"), ("20271020", None), ("", ""), ("", "20:00")]
)
def test_parse_show_skips_show_without_date_or_start(date, start) -> None:
    assert _parse(_show(date=date, start=start)) is None


def test_parse_show_end_past_midnight_rolls_to_next_day() -> None:
    parsed = _parse(_show(start="23:30", end="01:10"))

    assert parsed is not None
    assert parsed.start == datetime(2027, 10, 20, 23, 30)
    assert parsed.end == datetime(2027, 10, 21, 1, 10)


def test_parse_show_without_end_time_has_no_end() -> None:
    parsed = _parse(_show(end=None))

    assert parsed is not None
    assert parsed.end is None


def test_parse_show_prefers_external_ticket_link() -> None:
    parsed = _parse(
        _show(
            external_link="https://tickets.example.com/liff-special",
            show_key="ABC123",
        )
    )

    assert parsed is not None
    assert parsed.ticket_link == "https://tickets.example.com/liff-special"


@pytest.mark.parametrize("external_link", [None, "", "#", "tickets"])
def test_parse_show_builds_liff_ticket_link_from_show_key(external_link) -> None:
    parsed = _parse(_show(external_link=external_link, show_key="ABC123"))

    assert parsed is not None
    assert parsed.ticket_link == "https://www.liff.nl/tickets/?film=ABC123"


def test_parse_show_falls_back_to_show_page_link() -> None:
    parsed = _parse(_show(link="https://www.liff.nl/shows/mouse/"))

    assert parsed is not None
    assert parsed.ticket_link == "https://www.liff.nl/shows/mouse/"


def test_parse_show_falls_back_to_site_without_any_link() -> None:
    parsed = _parse(_show(link=None))

    assert parsed is not None
    assert parsed.ticket_link == liff.SITE


def test_parse_show_unknown_film_post_has_no_film_id() -> None:
    parsed = _parse(_show(film=999))

    assert parsed is not None
    assert parsed.film_id is None


def test_parse_show_accepts_film_and_location_ids_as_strings() -> None:
    parsed = _parse(_show(film="11", location="6"))

    assert parsed is not None
    assert parsed.film_id == 11
    assert parsed.location_name == "Kijkhuis 1"


def test_parse_show_without_location_has_empty_location_name() -> None:
    parsed = _parse(_show(location=None))

    assert parsed is not None
    assert parsed.location_name == ""


# --------------------------------------------------------------------------
# _cinema_for_location
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("location", "expected_cinema_id"),
    [
        ("Trianon 2", TRIANON_ID),
        ("TRIANON 1", TRIANON_ID),
        ("  Kijkhuis 2 – old ", KIJKHUIS_ID),
    ],
)
def test_cinema_for_known_location_prefix_has_no_room(
    location, expected_cinema_id
) -> None:
    assert _scraper()._cinema_for_location(location) == (expected_cinema_id, None)


def test_cinema_for_unknown_location_is_festival_with_location_as_room() -> None:
    assert _scraper()._cinema_for_location("  Het Nieuwe Buurthuis ") == (
        FESTIVAL_ID,
        "Het Nieuwe Buurthuis",
    )


def test_cinema_for_known_prefix_missing_from_db_is_festival() -> None:
    """"Lido" is a known prefix, but without a lido cinema row the screening
    goes to the festival, named by its location."""
    assert _scraper()._cinema_for_location("Lido 1") == (FESTIVAL_ID, "Lido 1")


def test_cinema_for_empty_location_is_festival_without_room() -> None:
    assert _scraper()._cinema_for_location("") == (FESTIVAL_ID, None)
    assert _scraper()._cinema_for_location("   ") == (FESTIVAL_ID, None)


# --------------------------------------------------------------------------
# Pure helpers
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("post", "expected"),
    [
        ({"title": {"rendered": "Mouse nl"}}, "Mouse"),
        ({"title": {"rendered": "Mouse en"}}, "Mouse"),
        ({"title": {"rendered": "Mouse EN"}}, "Mouse"),
        ({"title": {"rendered": "Rock &amp; Roll nl"}}, "Rock & Roll"),
        ({"title": "Plain Title"}, "Plain Title"),
        # Only a whitespace-separated suffix is a language marker.
        ({"title": {"rendered": "Amen"}}, "Amen"),
        ({"title": {"rendered": "Big Ben"}}, "Big Ben"),
        (
            {"title": {"rendered": "Mouse nl"}, "acf": {"customTitle": "Mouse!"}},
            "Mouse!",
        ),
        (
            {"title": {"rendered": "Mouse nl"}, "acf": {"title": "The Mouse"}},
            "The Mouse",
        ),
        (
            {
                "title": {"rendered": "Mouse nl"},
                "acf": {"customTitle": "Custom", "title": "Acf Title"},
            },
            "Custom",
        ),
        (
            {
                "title": {"rendered": "Mouse nl"},
                "acf": {"customTitle": "  ", "title": "Acf Title"},
            },
            "Acf Title",
        ),
        (
            {"title": {"rendered": "Mouse nl"}, "acf": {"customTitle": "Q &amp; A"}},
            "Q & A",
        ),
        ({"title": None}, ""),
        ({}, ""),
    ],
)
def test_post_title(post, expected) -> None:
    assert liff._post_title(post) == expected


def test_film_acf() -> None:
    films = {1: {"acf": {"director": "Someone"}}, 2: {"acf": None}, 3: {}}

    assert liff._film_acf(films, None) == {}
    assert liff._film_acf(films, 99) == {}
    assert liff._film_acf(films, 1) == {"director": "Someone"}
    assert liff._film_acf(films, 2) == {}
    assert liff._film_acf(films, 3) == {}


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (True, True),
        ("true", True),
        ("TRUE", True),
        (False, False),
        ("false", False),
        ("1", False),
        (1, False),
        (None, False),
        ("", False),
    ],
)
def test_is_truthy_flag(value, expected) -> None:
    assert liff._is_truthy_flag(value) is expected


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (5, 5),
        ("12", 12),
        (" 7 ", 7),
        (0, None),
        (-3, None),
        ("abc", None),
        ("", None),
        (None, None),
        (3.5, None),
    ],
)
def test_int_or_none(value, expected) -> None:
    assert liff._int_or_none(value) == expected
