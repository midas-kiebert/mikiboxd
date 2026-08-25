"""GenericEagerlyScraper's derived URLs, given a trailing-slash `url_base`.

Every call site (filmhallen.py, themovies.py, ...) passes a trailing-slash
`url_base`, so both `self.url` and every `ticket_link` built from
`self.url_base` regressed to a doubled "//" if the constructor didn't strip
it — a link real browsers/servers tolerate silently, but that
EAGERLY_URL_PATTERN (app/scraping/seat_availability.py) does not match,
making the showtime invisible to the seat-availability checker.
"""

from contextlib import contextmanager

from app.scraping.cinemas.generic import eagerly as eagerly_module
from app.scraping.seat_availability import supports


@contextmanager
def _fake_db_context():
    yield object()


def test_trailing_slash_url_base_does_not_double_up(monkeypatch) -> None:
    monkeypatch.setattr(eagerly_module, "get_db_context", _fake_db_context)
    monkeypatch.setattr(
        eagerly_module.cinema_crud,
        "get_cinema_id_by_key",
        lambda *, session, key: 1,
    )
    scraper = eagerly_module.GenericEagerlyScraper(
        cinema_key="filmhallen", url_base="https://filmhallen.nl/"
    )
    assert scraper.url_base == "https://filmhallen.nl"
    assert scraper.url == "https://filmhallen.nl/fk-feed/agenda"

    ticket_link = f"{scraper.url_base}/tickets/199603"
    assert ticket_link == "https://filmhallen.nl/tickets/199603"
    assert supports(ticket_link)


def test_url_base_without_a_trailing_slash_still_works(monkeypatch) -> None:
    monkeypatch.setattr(eagerly_module, "get_db_context", _fake_db_context)
    monkeypatch.setattr(
        eagerly_module.cinema_crud,
        "get_cinema_id_by_key",
        lambda *, session, key: 1,
    )
    scraper = eagerly_module.GenericEagerlyScraper(
        cinema_key="themovies", url_base="https://themovies.nl"
    )
    assert scraper.url_base == "https://themovies.nl"
    assert scraper.url == "https://themovies.nl/fk-feed/agenda"
