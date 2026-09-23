"""Regression tests for the scrape cadence rework and the publish-timing logs.

Covers the database-driven scrape schedule (shaped by weekday, nothing at
night, a late or missed slot caught up rather than dropped), the absence floor
that keeps deletion grace in hours now that runs are more frequent, the
Cineville REST parsing that replaced the per-film fan-out
and the broken GraphQL films query, and the two logs the admin publish-timing
view reads.
"""

from collections.abc import Callable
from contextlib import contextmanager
from datetime import datetime, timedelta

import pytest
from sqlmodel import select

from app.models.cinema import Cinema
from app.models.cineville_event import CinevilleEvent
from app.models.listing_first_seen import ListingFirstSeen
from app.models.movie import Movie
from app.models.showtime import Showtime
from app.models.showtime_source_presence import ShowtimeSourcePresence
from app.scraping import get_movies, get_showtimes, scrape_schedule
from app.services import cineville_events
from app.services import scrape_sync as scrape_sync_service
from app.services.publish_timing import _spread
from app.services.scrape_sync import ObservedPresence, record_success_run
from app.utils import now_amsterdam_naive

# ---------------------------------------------------------------------------
# scrape schedule
# ---------------------------------------------------------------------------


def test_slot_offset_is_stable_and_within_the_jitter():
    slot = datetime(2026, 9, 24, 9, 0)
    due = scrape_schedule.slot_due_at(slot)
    assert due == scrape_schedule.slot_due_at(slot)
    assert slot <= due < slot + scrape_schedule.SLOT_JITTER


def test_slots_are_not_all_at_the_same_minute():
    monday = datetime(2026, 9, 21)
    assert len({due.minute for due in scrape_schedule.due_times(monday)}) > 1


def test_half_hourly_slots_never_swap_order():
    """An offset stays under half the gap, so slots keep their order."""
    for day in range(21, 28):
        due = scrape_schedule.due_times(datetime(2026, 9, day))
        assert due == sorted(due)
        assert len(set(due)) == len(due)


def test_busy_days_get_more_runs_than_quiet_ones():
    runs = {
        name: len(scrape_schedule.due_times(datetime(2026, 9, day)))
        for name, day in (("mon", 21), ("tue", 22), ("thu", 24), ("sat", 26))
    }
    assert runs["mon"] > runs["thu"] > runs["tue"] > runs["sat"] > 0


def test_no_run_is_due_at_night():
    for day in range(21, 28):
        for due in scrape_schedule.due_times(datetime(2026, 9, day)):
            assert 8 <= due.hour <= 23


def test_a_missed_slot_is_still_due_later():
    """A scrape that didn't start on time runs on the next tick, not never."""
    slot_due = scrape_schedule.due_times(datetime(2026, 9, 21))[-1]
    much_later = slot_due + timedelta(minutes=40)
    assert scrape_schedule.latest_due_at(much_later) == slot_due
    assert scrape_schedule.is_due(
        now=much_later, last_started_at=slot_due - timedelta(minutes=55)
    )


def test_not_due_again_once_the_slot_has_run():
    slot_due = scrape_schedule.due_times(datetime(2026, 9, 21))[-1]
    assert not scrape_schedule.is_due(
        now=slot_due + timedelta(minutes=10),
        last_started_at=slot_due + timedelta(seconds=30),
    )


def test_the_night_waits_for_the_previous_evening_slot():
    """Between the last evening run and the first morning one nothing new is due."""
    evening = scrape_schedule.due_times(datetime(2026, 9, 23))[-1]
    assert scrape_schedule.latest_due_at(datetime(2026, 9, 24, 4, 0)) == evening


# ---------------------------------------------------------------------------
# deletion grace in hours, not runs
# ---------------------------------------------------------------------------


def _observe(showtime: Showtime, created_at: datetime | None = None) -> ObservedPresence:
    key = scrape_sync_service.showtime_identity_event_key(
        movie_id=showtime.movie_id,
        cinema_id=showtime.cinema_id,
        dt=showtime.datetime,
    )
    return ObservedPresence(
        source_event_key=key, showtime_id=showtime.id, source_created_at=created_at
    )


def test_recently_seen_showtime_survives_many_quick_misses(
    *,
    db_transaction,
    cinema_factory: Callable[..., Cinema],
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
):
    """Frequent runs mustn't delete a screening hidden for a few hours."""
    now = now_amsterdam_naive()
    cinema = cinema_factory()
    movie = movie_factory()
    keeper = showtime_factory(cinema=cinema, movie=movie, datetime=now + timedelta(days=3))
    target = showtime_factory(cinema=cinema, movie=movie, datetime=now + timedelta(days=4))
    stream = "cinema_scraper:test"

    record_success_run(
        session=db_transaction,
        source_stream=stream,
        observed_presences=[_observe(keeper), _observe(target)],
    )
    for _ in range(scrape_sync_service.MISSING_STREAK_TO_DEACTIVATE + 2):
        record_success_run(
            session=db_transaction,
            source_stream=stream,
            observed_presences=[_observe(keeper)],
        )

    assert db_transaction.get(Showtime, target.id) is not None
    presence = db_transaction.exec(
        select(ShowtimeSourcePresence).where(
            ShowtimeSourcePresence.source_stream == stream,
            ShowtimeSourcePresence.showtime_id == target.id,
        )
    ).one()
    assert presence.active is True


# ---------------------------------------------------------------------------
# ListingFirstSeen
# ---------------------------------------------------------------------------


def test_first_seen_is_logged_from_the_second_run_on(
    *,
    db_transaction,
    cinema_factory: Callable[..., Cinema],
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
):
    """A stream's first run is a baseline; later new listings get a window."""
    now = now_amsterdam_naive()
    cinema = cinema_factory()
    movie = movie_factory()
    existing = showtime_factory(cinema=cinema, movie=movie, datetime=now + timedelta(days=2))
    added = showtime_factory(cinema=cinema, movie=movie, datetime=now + timedelta(days=5))
    stream = f"cineville:{cinema.id}"
    created = now - timedelta(minutes=20)
    first_run_started = now - timedelta(hours=1)

    record_success_run(
        session=db_transaction,
        source_stream=stream,
        observed_presences=[_observe(existing)],
        started_at=first_run_started,
    )
    assert db_transaction.exec(select(ListingFirstSeen)).all() == []

    for _ in range(2):
        record_success_run(
            session=db_transaction,
            source_stream=stream,
            observed_presences=[_observe(existing), _observe(added, created)],
        )

    rows = db_transaction.exec(
        select(ListingFirstSeen).where(ListingFirstSeen.source_stream == stream)
    ).all()
    assert len(rows) == 1
    row = rows[0]
    assert row.movie_id == added.movie_id
    assert row.cinema_id == cinema.id
    assert row.showtime_datetime == added.datetime
    assert row.window_start == first_run_started
    assert row.source_created_at == created


# ---------------------------------------------------------------------------
# Cineville REST parsing
# ---------------------------------------------------------------------------


def test_film_parses_from_a_rest_production():
    film = get_movies._film_from_production(
        {
            "id": "p-1",
            "slug": "blue-heron",
            "title": "Blue Heron",
            "productionTypeId": "film",
            "attributes": {
                "cast": ["Eylul Guven"],
                "duration": 90,
                "directors": ["Sophy Romvari"],
                "releaseYear": 2025,
                "spokenLanguages": ["hu", "en"],
            },
        }
    )
    assert film.id == "p-1"
    assert film.directors == ["Sophy Romvari"]
    assert film.duration == 90
    assert film.releaseYear == 2025
    assert film.spokenLanguages == ["hu", "en"]


def _bulk_event(**overrides) -> dict:
    event = {
        "id": "e-1",
        "productionId": "p-1",
        "productionHint": {"title": "Blue Heron"},
        "attributes": {"subtitles": ["nl"]},
        "venueId": "v-1",
        "ticketingUrl": "https://tickets.example/1?utm_source=cineville",
        "startDate": "2026-10-01T18:00:00.000Z",
        "endDate": "2026-10-01T19:40:00.000Z",
        "isHidden": False,
        "createdAt": "2026-09-21T11:02:03.000Z",
        "updatedAt": "2026-09-21T11:02:03.000Z",
    }
    event.update(overrides)
    return event


def test_bulk_event_maps_venue_and_trims_ticket_link():
    record = get_showtimes._bulk_event_record(_bulk_event(), {"v-1": "LAB111"})
    assert record.venueName == "LAB111"
    assert record.ticketUrl == "https://tickets.example/1"
    assert record.subtitles == ["nl"]
    showtime = record.to_showtime()
    assert showtime.venueName == "LAB111"
    assert showtime.createdAt == "2026-09-21T11:02:03.000Z"


# ---------------------------------------------------------------------------
# CinevilleEvent log
# ---------------------------------------------------------------------------


def _record(**overrides) -> get_showtimes.CinevilleEventRecord:
    return get_showtimes._bulk_event_record(_bulk_event(**overrides), {"v-1": "Venue"})


def test_sweep_keeps_first_sighting_and_marks_dropped_events_gone(
    *,
    db_transaction,
    cinema_factory: Callable[..., Cinema],
    monkeypatch: pytest.MonkeyPatch,
):
    @contextmanager
    def fake_get_db_context():
        yield db_transaction

    # The sweep opens its own session; without this it reaches the main database.
    monkeypatch.setattr(cineville_events, "get_db_context", fake_get_db_context)
    cinema_factory(name="Venue", cineville=True)
    future = (datetime.utcnow() + timedelta(days=3)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    first = now_amsterdam_naive() - timedelta(hours=2)
    second = now_amsterdam_naive() - timedelta(hours=1)

    cineville_events.record_sweep(
        cineville_events.CinevilleSweep(
            started_at=first,
            events=[_record(id="stays", startDate=future), _record(id="drops", startDate=future)],
            films=[],
        )
    )
    cineville_events.record_sweep(
        cineville_events.CinevilleSweep(
            started_at=second,
            events=[_record(id="stays", startDate=future)],
            films=[],
        )
    )

    stays = db_transaction.get(CinevilleEvent, "stays")
    drops = db_transaction.get(CinevilleEvent, "drops")
    assert stays is not None and drops is not None
    db_transaction.refresh(stays)
    db_transaction.refresh(drops)
    assert stays.first_seen_at == first
    assert stays.last_seen_at == second
    assert stays.gone_at is None
    assert stays.cinema_id is not None
    assert drops.gone_at == second


# ---------------------------------------------------------------------------
# heatmap spreading
# ---------------------------------------------------------------------------


def test_spread_divides_a_window_over_its_hours():
    heatmap = [[0.0] * 24 for _ in range(7)]
    # Monday 21 Sep 2026, 09:30 -> 11:30: half an hour, a full hour, half an hour.
    _spread(heatmap, datetime(2026, 9, 21, 9, 30), datetime(2026, 9, 21, 11, 30), 1.0)
    assert heatmap[0][9] == pytest.approx(0.25)
    assert heatmap[0][10] == pytest.approx(0.5)
    assert heatmap[0][11] == pytest.approx(0.25)


def test_spread_puts_an_exact_moment_in_its_hour():
    heatmap = [[0.0] * 24 for _ in range(7)]
    moment = datetime(2026, 9, 24, 8, 15)  # a Thursday
    _spread(heatmap, moment, moment, 1.0)
    assert heatmap[3][8] == 1.0
