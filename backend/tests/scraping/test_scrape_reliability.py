"""Regression tests for the scrape reliability fixes.

Covers the presence-tracking changes that stopped showtimes being wrongly
deleted (stable ticket-less key, missing-streak of 3, always-degrade guard) and
the Cineville retry/backoff helper.
"""

import asyncio
from collections.abc import Callable
from datetime import timedelta

import aiohttp
import pytest
from sqlmodel import select

from app.models.cinema import Cinema
from app.models.movie import Movie
from app.models.scrape_run import ScrapeRunStatus
from app.models.showtime import Showtime
from app.models.showtime_source_presence import ShowtimeSourcePresence
from app.scraping import cineville_client
from app.scraping.cineville_client import (
    CinevilleFetchError,
    post_json_with_retry,
)
from app.services import scrape_sync as scrape_sync_service
from app.services.scrape_sync import ObservedPresence, record_success_run
from app.utils import now_amsterdam_naive

# ---------------------------------------------------------------------------
# showtime_identity_event_key
# ---------------------------------------------------------------------------


def test_identity_key_is_stable_and_ignores_ticket_link():
    """The presence key depends only on the showtime's unique identity."""
    dt = now_amsterdam_naive()
    key_a = scrape_sync_service.showtime_identity_event_key(
        movie_id=42, cinema_id=7, dt=dt
    )
    key_b = scrape_sync_service.showtime_identity_event_key(
        movie_id=42, cinema_id=7, dt=dt
    )
    assert key_a == key_b == "42|7|" + dt.isoformat()


def test_identity_key_differs_per_showtime_identity():
    dt = now_amsterdam_naive()
    base = scrape_sync_service.showtime_identity_event_key(
        movie_id=1, cinema_id=1, dt=dt
    )
    assert base != scrape_sync_service.showtime_identity_event_key(
        movie_id=2, cinema_id=1, dt=dt
    )
    assert base != scrape_sync_service.showtime_identity_event_key(
        movie_id=1, cinema_id=2, dt=dt
    )


# ---------------------------------------------------------------------------
# missing-streak deletion (must be 3, not 2)
# ---------------------------------------------------------------------------


def test_missing_streak_to_deactivate_is_three():
    assert scrape_sync_service.MISSING_STREAK_TO_DEACTIVATE == 3


def _observe(showtime: Showtime) -> ObservedPresence:
    key = scrape_sync_service.showtime_identity_event_key(
        movie_id=showtime.movie_id,
        cinema_id=showtime.cinema_id,
        dt=showtime.datetime,
    )
    return ObservedPresence(source_event_key=key, showtime_id=showtime.id)


def test_showtime_survives_two_misses_and_is_deleted_on_the_third(
    *,
    db_transaction,
    cinema_factory: Callable[..., Cinema],
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
):
    """A showtime is only orphan-deleted after 3 consecutive misses."""

    now = now_amsterdam_naive()
    cinema = cinema_factory()
    movie = movie_factory()
    keeper = showtime_factory(
        cinema=cinema, movie=movie, datetime=now + timedelta(days=3)
    )
    target = showtime_factory(
        cinema=cinema, movie=movie, datetime=now + timedelta(days=4)
    )
    stream = "cinema_scraper:test"

    # Run 0: both observed -> both presences active.
    record_success_run(
        session=db_transaction,
        source_stream=stream,
        observed_presences=[_observe(keeper), _observe(target)],
    )

    # Runs 1 and 2: only the keeper observed (keeps observed_count healthy so
    # the degraded guard does not fire); target accumulates misses.
    for _ in range(2):
        record_success_run(
            session=db_transaction,
            source_stream=stream,
            observed_presences=[_observe(keeper)],
        )
    assert db_transaction.get(Showtime, target.id) is not None

    # Run 3: third miss -> target deactivated and orphan-deleted.
    record_success_run(
        session=db_transaction,
        source_stream=stream,
        observed_presences=[_observe(keeper)],
    )
    assert db_transaction.get(Showtime, target.id) is None
    assert db_transaction.get(Showtime, keeper.id) is not None


def test_two_consecutive_empty_runs_stay_degraded_and_delete_nothing(
    *,
    db_transaction,
    cinema_factory: Callable[..., Cinema],
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
):
    """A source that suddenly observes 0 is always degraded — even twice in a

    row — so a transient outage never deletes real showtimes (the old escape
    hatch let the second empty run delete).
    """
    now = now_amsterdam_naive()
    cinema = cinema_factory()
    movie = movie_factory()
    showtime = showtime_factory(
        cinema=cinema, movie=movie, datetime=now + timedelta(days=3)
    )
    stream = "cinema_scraper:test"

    record_success_run(
        session=db_transaction,
        source_stream=stream,
        observed_presences=[_observe(showtime)],
    )

    for _ in range(2):
        status, deleted = record_success_run(
            session=db_transaction,
            source_stream=stream,
            observed_presences=[],
        )
        assert status == ScrapeRunStatus.DEGRADED
        assert deleted == []

    assert db_transaction.get(Showtime, showtime.id) is not None
    presence = db_transaction.exec(
        select(ShowtimeSourcePresence).where(
            ShowtimeSourcePresence.source_stream == stream
        )
    ).first()
    # Degraded runs never mark presences missing.
    assert presence is not None
    assert presence.missing_streak == 0


# ---------------------------------------------------------------------------
# Cineville retry / backoff
# ---------------------------------------------------------------------------


class _FakeResponse:
    def __init__(self, status: int, json_data=None, headers=None):
        self.status = status
        self.reason = "reason"
        self._json = json_data
        self.headers = headers or {}

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    def raise_for_status(self):
        if self.status >= 400:
            raise aiohttp.ClientResponseError(
                request_info=None, history=(), status=self.status
            )

    async def json(self):
        return self._json


class _FakeSession:
    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = 0

    def post(self, *args, **kwargs):
        response = self._responses[self.calls]
        self.calls += 1
        return response


@pytest.fixture(autouse=True)
def _no_sleep(monkeypatch):
    async def _instant(*_args, **_kwargs):
        return None

    monkeypatch.setattr(cineville_client.asyncio, "sleep", _instant)


def test_retry_recovers_after_429s():
    session = _FakeSession(
        [
            _FakeResponse(429),
            _FakeResponse(429),
            _FakeResponse(200, json_data={"ok": True}),
        ]
    )
    result = asyncio.run(
        post_json_with_retry(
            session=session,
            url="https://example.test",
            headers={},
            payload={},
            timeout=aiohttp.ClientTimeout(total=1),
            context="test",
        )
    )
    assert result == {"ok": True}
    assert session.calls == 3


def test_retry_raises_after_exhausting_attempts():
    session = _FakeSession(
        [_FakeResponse(429) for _ in range(cineville_client.CINEVILLE_MAX_ATTEMPTS)]
    )
    with pytest.raises(CinevilleFetchError):
        asyncio.run(
            post_json_with_retry(
                session=session,
                url="https://example.test",
                headers={},
                payload={},
                timeout=aiohttp.ClientTimeout(total=1),
                context="test",
            )
        )
    assert session.calls == cineville_client.CINEVILLE_MAX_ATTEMPTS
