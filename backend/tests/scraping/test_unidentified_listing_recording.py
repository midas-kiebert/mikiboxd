"""Cinema scrapers report the screenings of films they skip for want of a TMDB match.

Without the screening times there is nothing to line a skipped film up with
Cineville's showtimes, and a trusted scraper's miss turns into deleting them.
"""

from datetime import datetime, timedelta

from bs4 import BeautifulSoup

from app.scraping.cinemas.amsterdam import lab111 as lab111_module
from app.scraping.cinemas.generic import eagerly as eagerly_module
from app.scraping.date_conversion import DUTCH_MONTHS, DUTCH_WEEKDAYS
from app.services import unidentified_listings
from app.services.unidentified_listings import UnidentifiedListing

_WEEKDAY_BY_NUMBER = {number: name for name, number in DUTCH_WEEKDAYS.items()}
_MONTH_BY_NUMBER = {number: name for name, number in DUTCH_MONTHS.items()}


def _lab111_date_text(moment: datetime) -> str:
    """LAB111's own 'wo 16 sep 20:45' format."""
    return (
        f"{_WEEKDAY_BY_NUMBER[moment.weekday()]} {moment.day} "
        f"{_MONTH_BY_NUMBER[moment.month]} {moment:%H:%M}"
    )


def test_lab111_records_the_screenings_of_a_film_it_cannot_identify(
    monkeypatch,
) -> None:
    monkeypatch.setattr(lab111_module, "find_tmdb_id", lambda **_: None)
    scraper = lab111_module.LAB111Scraper.__new__(lab111_module.LAB111Scraper)
    scraper.cinema_key = lab111_module.CINEMA_KEY
    scraper.cinema_id = 7101
    first = (datetime.now() + timedelta(days=3)).replace(
        hour=20, minute=45, second=0, microsecond=0
    )
    second = first + timedelta(days=4, hours=-6, minutes=-25)
    html = f"""
    <div class="row filmdetails" data-title="Fahrenheit 9/11">
      <table>
        <tr class="day">
          <td><a href="https://tickets.lab111.nl/show/1">{_lab111_date_text(first)}</a></td>
          <td><span class="theatre_name">LAB 1</span></td>
        </tr>
        <tr class="day">
          <td><a href="https://tickets.lab111.nl/show/2">{_lab111_date_text(second)}</a></td>
          <td><span class="theatre_name">LAB 2</span></td>
        </tr>
      </table>
    </div>
    """
    div = BeautifulSoup(html, "html.parser").find("div")

    assert scraper._process_film_div(div) is None
    assert unidentified_listings.consume_unidentified_listings(7101) == [
        UnidentifiedListing(cinema_id=7101, title="fahrenheit 9/11", datetime=first),
        UnidentifiedListing(cinema_id=7101, title="fahrenheit 9/11", datetime=second),
    ]


def test_eagerly_records_only_this_venues_screenings_of_an_unidentified_film(
    monkeypatch,
) -> None:
    monkeypatch.setattr(eagerly_module, "find_tmdb_id", lambda **_: None)
    scraper = eagerly_module.GenericEagerlyScraper.__new__(
        eagerly_module.GenericEagerlyScraper
    )
    scraper.cinema_key = "bioscopen-leiden-lido"
    scraper.cinema_id = 7102
    scraper.url_base = "https://www.bioscopenleiden.nl"
    scraper.theatre_filter = "Lido"
    scraper.subtitle_venue_aliases = None
    value = {
        "times": [
            {"location": "Lido 2", "program_start": "202609162045", "provider_id": 1},
            {"location": "Trianon 1", "program_start": "202609171900", "provider_id": 2},
        ],
        "director_name": {"value": "Michael Moore"},
    }

    assert scraper._process_movie_entry(slug="fahrenheit-9-11", value=value) is None
    assert unidentified_listings.consume_unidentified_listings(7102) == [
        UnidentifiedListing(
            cinema_id=7102,
            title="fahrenheit 9 11",
            datetime=datetime(2026, 9, 16, 20, 45),
        )
    ]
