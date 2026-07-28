"""Cooldown and partial-result handling for the two Letterboxd sync services.

Regression tests for the failure mode where `last_watched_sync` stayed NULL for
some users: the scrape ran before the cooldown check (so a throttled caller
still paid for the fetch), a failed scrape recorded nothing (so those users
retried on every app foreground), and a partial scrape was written as if it
were the user's complete list.
"""

from datetime import timedelta

import pytest
from pytest_mock import MockerFixture
from sqlmodel import Session

from app.crud import watched as watched_crud
from app.crud import watchlist as watchlist_crud
from app.exceptions.scraper_exceptions import LetterboxdTemporarilyUnavailable
from app.exceptions.watchlist_exceptions import WatchedSyncTooSoon, WatchlistSyncTooSoon
from app.scraping.letterboxd.utils import SlugScrapeResult
from app.services import watched as watched_service
from app.services import watchlist as watchlist_service
from app.services.letterboxd_sync import SYNC_COOLDOWN
from app.utils import now_amsterdam_naive


def _user_without_syncs(user_factory):
    user = user_factory()
    user.letterboxd.last_watchlist_sync = None
    user.letterboxd.last_watched_sync = None
    user.letterboxd.last_watchlist_sync_attempt = None
    user.letterboxd.last_watched_sync_attempt = None
    user.letterboxd.last_watched_full_sync = None
    return user


def test_watched_sync_records_attempt_before_scraping(
    mocker: MockerFixture,
    db_transaction: Session,
    user_factory,
):
    # A scrape that blows up must still leave a timestamp behind, otherwise the
    # user has nothing to back off from and re-scrapes on every foreground.
    user = _user_without_syncs(user_factory)
    mocker.patch(
        "app.services.watched.scrape_watched",
        side_effect=LetterboxdTemporarilyUnavailable(),
    )

    with pytest.raises(LetterboxdTemporarilyUnavailable):
        watched_service.sync_watched(session=db_transaction, user_id=user.id)

    assert user.letterboxd.last_watched_sync is None
    assert user.letterboxd.last_watched_sync_attempt is not None


def test_watched_sync_in_cooldown_does_not_scrape(
    mocker: MockerFixture,
    db_transaction: Session,
    user_factory,
):
    # The cooldown has to short-circuit *before* the scrape: checking it after
    # means the throttled caller has already cost us the full paginated fetch.
    user = _user_without_syncs(user_factory)
    user.letterboxd.last_watched_sync_attempt = now_amsterdam_naive()
    db_transaction.flush()
    mock_scrape = mocker.patch("app.services.watched.scrape_watched")

    with pytest.raises(WatchedSyncTooSoon):
        watched_service.sync_watched(session=db_transaction, user_id=user.id)

    mock_scrape.assert_not_called()


def test_watched_sync_runs_once_cooldown_has_passed(
    mocker: MockerFixture,
    db_transaction: Session,
    user_factory,
):
    user = _user_without_syncs(user_factory)
    user.letterboxd.last_watched_sync_attempt = now_amsterdam_naive() - SYNC_COOLDOWN
    db_transaction.flush()
    mocker.patch(
        "app.services.watched.scrape_watched",
        return_value=SlugScrapeResult(slugs=["heat"], is_complete=True),
    )

    watched_service.sync_watched(session=db_transaction, user_id=user.id)

    assert user.letterboxd.last_watched_sync is not None
    assert watched_crud.does_watched_selection_exist(
        session=db_transaction,
        letterboxd_slug="heat",
        letterboxd_username=user.letterboxd_username,
    )


def test_watched_sync_keeps_existing_rows_when_scrape_is_incomplete(
    mocker: MockerFixture,
    db_transaction: Session,
    user_factory,
):
    # The sync replaces the stored rows wholesale, so a partial scrape must be
    # discarded rather than silently deleting films the user has watched.
    user = _user_without_syncs(user_factory)
    watched_crud.add_watched_selection(
        session=db_transaction,
        letterboxd_username=user.letterboxd_username,
        letterboxd_slug="heat",
    )
    db_transaction.flush()
    mocker.patch(
        "app.services.watched.scrape_watched",
        return_value=SlugScrapeResult(slugs=["the-thing"], is_complete=False),
    )

    with pytest.raises(LetterboxdTemporarilyUnavailable):
        watched_service.sync_watched(session=db_transaction, user_id=user.id)

    assert watched_crud.does_watched_selection_exist(
        session=db_transaction,
        letterboxd_slug="heat",
        letterboxd_username=user.letterboxd_username,
    )
    assert user.letterboxd.last_watched_sync is None


def test_watched_sync_tops_up_from_rss_without_walking_pages(
    mocker: MockerFixture,
    db_transaction: Session,
    user_factory,
):
    # Steady state: one feed request replaces a page-per-72-films walk.
    user = _user_without_syncs(user_factory)
    watched_crud.add_watched_selection(
        session=db_transaction,
        letterboxd_username=user.letterboxd_username,
        letterboxd_slug="heat",
    )
    user.letterboxd.last_watched_full_sync = now_amsterdam_naive() - timedelta(days=1)
    db_transaction.flush()
    mock_scrape = mocker.patch("app.services.watched.scrape_watched")
    mocker.patch(
        "app.services.watched.get_recent_watched_slugs",
        return_value=["the-thing", "heat"],
    )

    watched_service.sync_watched(session=db_transaction, user_id=user.id)

    mock_scrape.assert_not_called()
    for slug in ("heat", "the-thing"):
        assert watched_crud.does_watched_selection_exist(
            session=db_transaction,
            letterboxd_slug=slug,
            letterboxd_username=user.letterboxd_username,
        )
    assert user.letterboxd.last_watched_sync is not None


def test_rss_path_links_rows_whose_film_has_since_been_catalogued(
    mocker: MockerFixture,
    db_transaction: Session,
    user_factory,
    movie_factory,
):
    # The RSS path never rewrites existing rows, so a row stored before its
    # film reached our catalog would stay unlinked — and an unlinked row is
    # invisible to get_watched, i.e. not treated as watched.
    user = _user_without_syncs(user_factory)
    watched_crud.add_watched_selection(
        session=db_transaction,
        letterboxd_username=user.letterboxd_username,
        letterboxd_slug="heat",
    )
    movie = movie_factory(letterboxd_slug="heat")
    user.letterboxd.last_watched_full_sync = now_amsterdam_naive() - timedelta(days=1)
    db_transaction.flush()
    mocker.patch("app.services.watched.get_recent_watched_slugs", return_value=[])

    watched_service.sync_watched(session=db_transaction, user_id=user.id)

    assert watched_crud.get_watched(
        session=db_transaction, letterboxd_username=user.letterboxd_username
    ) == [movie]


def test_watched_sync_walks_pages_when_full_resync_is_due(
    mocker: MockerFixture,
    db_transaction: Session,
    user_factory,
):
    # The feed only ever adds slugs, so removals are reconciled by the periodic
    # full walk — which must actually replace the stored rows.
    user = _user_without_syncs(user_factory)
    watched_crud.add_watched_selection(
        session=db_transaction,
        letterboxd_username=user.letterboxd_username,
        letterboxd_slug="unwatched-since",
    )
    user.letterboxd.last_watched_full_sync = (
        now_amsterdam_naive() - watched_service.WATCHED_FULL_RESYNC_INTERVAL
    )
    db_transaction.flush()
    mock_rss = mocker.patch("app.services.watched.get_recent_watched_slugs")
    mocker.patch(
        "app.services.watched.scrape_watched",
        return_value=SlugScrapeResult(slugs=["heat"], is_complete=True),
    )

    watched_service.sync_watched(session=db_transaction, user_id=user.id)

    mock_rss.assert_not_called()
    assert not watched_crud.does_watched_selection_exist(
        session=db_transaction,
        letterboxd_slug="unwatched-since",
        letterboxd_username=user.letterboxd_username,
    )
    assert user.letterboxd.last_watched_full_sync is not None


def test_watched_sync_falls_back_to_pages_when_feed_is_unavailable(
    mocker: MockerFixture,
    db_transaction: Session,
    user_factory,
):
    user = _user_without_syncs(user_factory)
    watched_crud.add_watched_selection(
        session=db_transaction,
        letterboxd_username=user.letterboxd_username,
        letterboxd_slug="heat",
    )
    user.letterboxd.last_watched_full_sync = now_amsterdam_naive() - timedelta(days=1)
    db_transaction.flush()
    mocker.patch("app.services.watched.get_recent_watched_slugs", return_value=None)
    mock_scrape = mocker.patch(
        "app.services.watched.scrape_watched",
        return_value=SlugScrapeResult(slugs=["heat", "the-thing"], is_complete=True),
    )

    watched_service.sync_watched(session=db_transaction, user_id=user.id)

    mock_scrape.assert_called_once()


def test_first_watched_sync_walks_pages(
    mocker: MockerFixture,
    db_transaction: Session,
    user_factory,
):
    # Nothing stored yet, so there is no baseline for the feed to top up.
    user = _user_without_syncs(user_factory)
    mock_rss = mocker.patch("app.services.watched.get_recent_watched_slugs")
    mocker.patch(
        "app.services.watched.scrape_watched",
        return_value=SlugScrapeResult(slugs=["heat"], is_complete=True),
    )

    watched_service.sync_watched(session=db_transaction, user_id=user.id)

    mock_rss.assert_not_called()
    assert user.letterboxd.last_watched_full_sync is not None


def test_watchlist_sync_in_cooldown_does_not_scrape(
    mocker: MockerFixture,
    db_transaction: Session,
    user_factory,
):
    user = _user_without_syncs(user_factory)
    user.letterboxd.last_watchlist_sync_attempt = now_amsterdam_naive()
    db_transaction.flush()
    mock_scrape = mocker.patch("app.services.watchlist.scrape_watchlist")

    with pytest.raises(WatchlistSyncTooSoon):
        watchlist_service.sync_watchlist(session=db_transaction, user_id=user.id)

    mock_scrape.assert_not_called()


def test_watchlist_sync_keeps_existing_rows_when_scrape_is_incomplete(
    mocker: MockerFixture,
    db_transaction: Session,
    user_factory,
):
    user = _user_without_syncs(user_factory)
    watchlist_crud.add_watchlist_selection(
        session=db_transaction,
        letterboxd_username=user.letterboxd_username,
        letterboxd_slug="heat",
    )
    db_transaction.flush()
    mocker.patch(
        "app.services.watchlist.scrape_watchlist",
        return_value=SlugScrapeResult(slugs=["the-thing"], is_complete=False),
    )

    with pytest.raises(LetterboxdTemporarilyUnavailable):
        watchlist_service.sync_watchlist(session=db_transaction, user_id=user.id)

    assert watchlist_crud.does_watchlist_selection_exist(
        session=db_transaction,
        letterboxd_slug="heat",
        letterboxd_username=user.letterboxd_username,
    )
    assert user.letterboxd.last_watchlist_sync is None
