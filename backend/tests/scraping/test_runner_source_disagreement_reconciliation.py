"""Recap disagreements can go stale within a single run.

Cineville scrapers run before cinema scrapers in ``run()``. The insert guard
can flag a slot as disputed using the cinema scraper's *previous* match, and
then that same cinema scraper's own pass minutes later (same run) re-resolves
the title and silently relinks the showtime to the correct movie via
``get_showtime_reassignment_candidate`` — before the recap is even built.
Reporting that stale snapshot as an unresolved disagreement is misleading.
"""

from contextlib import contextmanager
from datetime import timedelta

import pytest
from sqlmodel import Session

from app.scraping import runner
from app.services.showtime_title_conflict import SourceDisagreement
from app.utils import now_amsterdam_naive


@pytest.fixture(autouse=True)
def _use_test_session_for_get_db_context(
    monkeypatch: pytest.MonkeyPatch, db_transaction: Session
) -> None:
    @contextmanager
    def fake_get_db_context():
        yield db_transaction

    monkeypatch.setattr(runner, "get_db_context", fake_get_db_context)


def _slot_time():
    return now_amsterdam_naive().replace(
        hour=21, minute=30, second=0, microsecond=0
    ) + timedelta(days=9)


def test_drops_disagreement_the_cinema_scraper_already_fixed(
    *,
    db_transaction: Session,
    cinema_factory,
    movie_factory,
    showtime_factory,
) -> None:
    cinema = cinema_factory(cineville=True)
    correct_movie = movie_factory(title="All About Lily Chou-Chou")
    slot = _slot_time()

    # By recap time the showtime has already been reassigned to the correct
    # movie by the cinema scraper's own later pass this run.
    showtime_factory(cinema=cinema, movie=correct_movie, datetime=slot)
    db_transaction.flush()

    stale_disagreement = SourceDisagreement(
        cinema_id=cinema.id,
        showtime_datetime=slot,
        cineville_movie_id=correct_movie.id,
        cineville_movie_title=correct_movie.title,
        cinema_scraper_movie_id=999999,
        cinema_scraper_movie_title="The Making Of",
        detected_by="insert_guard",
        kept_movie_id=999999,
    )

    result = runner._drop_source_disagreements_resolved_since([stale_disagreement])

    assert result == []


def test_keeps_disagreement_still_unresolved(
    *,
    db_transaction: Session,
    cinema_factory,
    movie_factory,
    showtime_factory,
) -> None:
    cinema = cinema_factory(cineville=True)
    wrong_movie = movie_factory(title="The Making Of")
    slot = _slot_time()

    # Nothing corrected this slot since the disagreement was recorded — the
    # showtime still points at the movie that was "kept".
    showtime_factory(cinema=cinema, movie=wrong_movie, datetime=slot)
    db_transaction.flush()

    still_wrong_disagreement = SourceDisagreement(
        cinema_id=cinema.id,
        showtime_datetime=slot,
        cineville_movie_id=123456,
        cineville_movie_title="All About Lily Chou-Chou",
        cinema_scraper_movie_id=wrong_movie.id,
        cinema_scraper_movie_title=wrong_movie.title,
        detected_by="insert_guard",
        kept_movie_id=wrong_movie.id,
    )

    result = runner._drop_source_disagreements_resolved_since(
        [still_wrong_disagreement]
    )

    assert result == [still_wrong_disagreement]
