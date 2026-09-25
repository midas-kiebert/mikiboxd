"""Cineville lists a festival as one venue. An event at a venue whose cinema is
of kind "festival" must be tagged with that festival, marked as covered by the
pass, and placed at the real cinema when a festival scraper already listed the
screening there — at the festival row itself otherwise.
"""

from contextlib import contextmanager

import pytest
from sqlmodel import Session, select

from app.core.enums import CinemaKind
from app.models.movie import MovieCreate
from app.models.showtime import Showtime
from app.scraping import scrape
from app.utils import now_amsterdam_naive, to_amsterdam_time


@pytest.fixture(autouse=True)
def _use_test_session_for_get_db_context(
    monkeypatch: pytest.MonkeyPatch, db_transaction: Session
) -> None:
    @contextmanager
    def fake_get_db_context():
        yield db_transaction

    monkeypatch.setattr(scrape, "get_db_context", fake_get_db_context)


_START_UTC = "2027-10-20T18:00:00.000000Z"
_END_UTC = "2027-10-20T19:40:00.000000Z"


def _prepared_movie(
    *, movie_id: int, title: str, venue_name: str, ticket_url: str | None
):
    return scrape.PreparedCinevilleMovie(
        production_id="prod-festival",
        movie=MovieCreate(id=movie_id, title=title),
        showtimes=[
            scrape.PreparedCinevilleShowtime(
                id="show-festival",
                start_date=_START_UTC,
                end_date=_END_UTC,
                ticket_url=ticket_url,
                subtitles=None,
                venue_name=venue_name,
            )
        ],
    )


def _rows_for(session: Session, movie_id: int) -> list[Showtime]:
    return list(
        session.exec(select(Showtime).where(Showtime.movie_id == movie_id)).all()
    )


def test_festival_event_lands_on_scraper_row_at_real_cinema(
    *,
    db_transaction: Session,
    cinema_factory,
    movie_factory,
    showtime_factory,
) -> None:
    festival = cinema_factory(kind=CinemaKind.FESTIVAL, cineville=True)
    real_cinema = cinema_factory(cineville=True)
    movie = movie_factory(title="Mouse")
    slot = to_amsterdam_time(_START_UTC)
    scraper_link = "https://www.liff.nl/tickets/?film=mouse-1"
    scraper_row = showtime_factory(
        cinema=real_cinema,
        movie=movie,
        datetime=slot,
        ticket_link=scraper_link,
        festival_id=festival.id,
        cineville_pass=None,
    )

    scrape._persist_cineville_results_batch(
        prepared_movies=[
            _prepared_movie(
                movie_id=movie.id,
                title=movie.title,
                venue_name=festival.name,
                ticket_url=None,
            )
        ],
        default_started_at=now_amsterdam_naive(),
    )

    rows = _rows_for(db_transaction, movie.id)
    assert len(rows) == 1
    row = rows[0]
    assert row.id == scraper_row.id
    assert row.cinema_id == real_cinema.id
    assert row.festival_id == festival.id
    assert row.cineville_pass is True
    # Cineville's festival event has no ticket link; the scraper's stays.
    assert row.ticket_link == scraper_link


def test_festival_event_without_scraper_row_is_placed_at_festival(
    *,
    db_transaction: Session,
    cinema_factory,
) -> None:
    festival = cinema_factory(kind=CinemaKind.FESTIVAL, cineville=True)
    slot = to_amsterdam_time(_START_UTC)

    scrape._persist_cineville_results_batch(
        prepared_movies=[
            _prepared_movie(
                movie_id=880001,
                title="Some Festival Film",
                venue_name=festival.name,
                ticket_url=None,
            )
        ],
        default_started_at=now_amsterdam_naive(),
    )

    rows = _rows_for(db_transaction, 880001)
    assert len(rows) == 1
    row = rows[0]
    assert row.cinema_id == festival.id
    assert row.festival_id == festival.id
    assert row.cineville_pass is True
    assert row.datetime == slot


def test_regular_venue_event_has_no_festival_and_follows_cinema(
    *,
    db_transaction: Session,
    cinema_factory,
) -> None:
    cinema = cinema_factory(kind=CinemaKind.CINEMA, cineville=True)

    scrape._persist_cineville_results_batch(
        prepared_movies=[
            _prepared_movie(
                movie_id=880002,
                title="Some Regular Film",
                venue_name=cinema.name,
                ticket_url="https://cineville.example/ticket",
            )
        ],
        default_started_at=now_amsterdam_naive(),
    )

    rows = _rows_for(db_transaction, 880002)
    assert len(rows) == 1
    row = rows[0]
    assert row.cinema_id == cinema.id
    assert row.festival_id is None
    assert row.cineville_pass is None
    assert row.ticket_link == "https://cineville.example/ticket"
