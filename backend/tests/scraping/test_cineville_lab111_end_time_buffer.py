"""LAB111's own programme end time always includes a 15-minute commercial/
trailer intro on top of the film's runtime. Cineville's end time for the same
screening is the bare runtime, so it must get the same 15-minute buffer added
when persisted — otherwise the two sources disagree on when the show ends.
"""

from contextlib import contextmanager
from datetime import timedelta

import pytest
from sqlmodel import Session

from app.crud import showtime as showtime_crud
from app.models.movie import MovieCreate
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


_START_UTC = "2026-09-15T18:00:00.000000Z"
_END_UTC = "2026-09-15T19:40:00.000000Z"


def _prepared_movie(*, movie_id: int, venue_name: str):
    return scrape.PreparedCinevilleMovie(
        production_id="prod-1",
        movie=MovieCreate(id=movie_id, title="Some Film"),
        showtimes=[
            scrape.PreparedCinevilleShowtime(
                id="show-1",
                start_date=_START_UTC,
                end_date=_END_UTC,
                ticket_url="https://cineville.example/ticket",
                subtitles=None,
                venue_name=venue_name,
            )
        ],
    )


def test_cineville_end_time_gets_15_minute_buffer_for_lab111(
    *,
    db_transaction: Session,
    cinema_factory,
) -> None:
    cinema = cinema_factory(key="lab111", cineville=True)
    slot = to_amsterdam_time(_START_UTC)
    bare_end = to_amsterdam_time(_END_UTC)

    scrape._persist_cineville_results_batch(
        prepared_movies=[_prepared_movie(movie_id=1001, venue_name=cinema.name)],
        default_started_at=now_amsterdam_naive(),
    )

    showtime = showtime_crud.get_showtime_by_unique_fields(
        session=db_transaction,
        movie_id=1001,
        cinema_id=cinema.id,
        datetime=slot,
    )
    assert showtime is not None
    assert showtime.end_datetime == bare_end + timedelta(minutes=15)


def test_cineville_end_time_is_unchanged_for_other_cinemas(
    *,
    db_transaction: Session,
    cinema_factory,
) -> None:
    cinema = cinema_factory(key="filmhallen", cineville=True)
    slot = to_amsterdam_time(_START_UTC)
    bare_end = to_amsterdam_time(_END_UTC)

    scrape._persist_cineville_results_batch(
        prepared_movies=[_prepared_movie(movie_id=1002, venue_name=cinema.name)],
        default_started_at=now_amsterdam_naive(),
    )

    showtime = showtime_crud.get_showtime_by_unique_fields(
        session=db_transaction,
        movie_id=1002,
        cinema_id=cinema.id,
        datetime=slot,
    )
    assert showtime is not None
    assert showtime.end_datetime == bare_end
