"""Regression tests for the watchlist new-showtime email digest service.

These cover ``_find_newly_available_movie_ids`` — the core "newly available
movie" detection logic — and the window-selection behaviour of
``build_and_send_digest``. See ``app/services/watchlist_digest.py`` for the
rules being tested: a movie only counts as "newly available" when it
currently has at least one upcoming (``datetime > now``) showtime AND none of
its current upcoming showtimes existed (``created_at``) before the lookback
window started.
"""

from collections.abc import Callable
from datetime import timedelta

from sqlmodel import Session, col, select

from app.core.enums import DigestFrequency
from app.crud import watchlist as watchlist_crud
from app.models.movie import Movie
from app.models.showtime import Showtime
from app.models.user import User
from app.services.watchlist_digest import (
    _find_newly_available_movie_ids,
    build_and_send_digest,
)
from app.utils import now_amsterdam_naive


def _all_movie_ids_subquery():
    """A source subquery selecting every movie id — stands in for a watchlist."""
    return select(col(Movie.id))


def test_movie_with_only_pre_window_future_showtime_is_not_newly_available(
    *,
    db_transaction: Session,
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
):
    """A showtime created long ago that is still upcoming is already known."""
    now = now_amsterdam_naive()
    window_start = now - timedelta(days=1)

    movie = movie_factory()
    showtime_factory(
        movie=movie,
        datetime=now + timedelta(days=5),
        created_at=now - timedelta(days=30),
    )

    result = _find_newly_available_movie_ids(
        session=db_transaction,
        source_subquery=_all_movie_ids_subquery(),
        now=now,
        window_start=window_start,
    )

    assert movie.id not in result


def test_movie_with_no_prior_showtime_and_new_future_showtime_is_newly_available(
    *,
    db_transaction: Session,
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
):
    """A movie whose only upcoming showtime was just inserted is flagged."""
    now = now_amsterdam_naive()
    window_start = now - timedelta(days=1)

    movie = movie_factory()
    showtime_factory(
        movie=movie,
        datetime=now + timedelta(days=5),
        created_at=now - timedelta(hours=1),
    )

    result = _find_newly_available_movie_ids(
        session=db_transaction,
        source_subquery=_all_movie_ids_subquery(),
        now=now,
        window_start=window_start,
    )

    assert movie.id in result


def test_movie_with_only_past_showtime_is_not_newly_available(
    *,
    db_transaction: Session,
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
):
    """No current future showtime at all means it cannot be "newly available"."""
    now = now_amsterdam_naive()
    window_start = now - timedelta(days=1)

    movie = movie_factory()
    showtime_factory(
        movie=movie,
        datetime=now - timedelta(days=1),
        created_at=now - timedelta(hours=1),
    )

    result = _find_newly_available_movie_ids(
        session=db_transaction,
        source_subquery=_all_movie_ids_subquery(),
        now=now,
        window_start=window_start,
    )

    assert movie.id not in result


def test_movie_with_existing_future_showtime_plus_new_one_is_not_newly_available(
    *,
    db_transaction: Session,
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
):
    """A movie that already had an upcoming showtime stays "known" even if it

    also gets a brand-new additional showtime within the window — only movies
    with zero prior future showtimes should be flagged.
    """
    now = now_amsterdam_naive()
    window_start = now - timedelta(days=1)

    movie = movie_factory()
    showtime_factory(
        movie=movie,
        datetime=now + timedelta(days=3),
        created_at=now - timedelta(days=10),
    )
    showtime_factory(
        movie=movie,
        datetime=now + timedelta(days=4),
        created_at=now - timedelta(hours=1),
    )

    result = _find_newly_available_movie_ids(
        session=db_transaction,
        source_subquery=_all_movie_ids_subquery(),
        now=now,
        window_start=window_start,
    )

    assert movie.id not in result


def test_movie_not_in_source_subquery_is_never_returned(
    *,
    db_transaction: Session,
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
):
    """A movie outside the source set is excluded, even with a brand-new showtime."""
    now = now_amsterdam_naive()
    window_start = now - timedelta(days=1)

    in_source_movie = movie_factory()
    excluded_movie = movie_factory()
    showtime_factory(
        movie=excluded_movie,
        datetime=now + timedelta(days=5),
        created_at=now - timedelta(hours=1),
    )

    source_subquery = select(col(Movie.id)).where(
        col(Movie.id) == in_source_movie.id
    )

    result = _find_newly_available_movie_ids(
        session=db_transaction,
        source_subquery=source_subquery,
        now=now,
        window_start=window_start,
    )

    assert excluded_movie.id not in result
    assert result == set()


def test_build_and_send_digest_window_falls_back_to_lookback_when_never_sent(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
    monkeypatch,
):
    """With no prior send, the window starts at ``now - lookback`` (1 day for DAILY)."""
    now = now_amsterdam_naive()
    monkeypatch.setattr(
        "app.services.watchlist_digest.now_amsterdam_naive", lambda: now
    )
    monkeypatch.setattr(
        "app.services.watchlist_digest.send_email", lambda **kwargs: None
    )

    user = user_factory(
        notify_watchlist_digest_frequency=DigestFrequency.DAILY,
        notify_watchlist_digest_last_sent_at=None,
    )
    assert user.letterboxd_username is not None

    movie = movie_factory()
    watchlist_crud.add_watchlist_selection(
        session=db_transaction,
        letterboxd_username=user.letterboxd_username,
        letterboxd_slug=movie.letterboxd_slug,
        movie_id=movie.id,
    )

    # Created within the last day -> should count as newly available, since
    # the fallback window for DAILY is now - 1 day.
    showtime_factory(
        movie=movie,
        datetime=now + timedelta(days=2),
        created_at=now - timedelta(hours=12),
    )

    sent = build_and_send_digest(session=db_transaction, user=user)

    assert sent is True
    assert user.notify_watchlist_digest_last_sent_at == now


def test_build_and_send_digest_window_uses_last_sent_at_when_set(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
    monkeypatch,
):
    """When ``notify_watchlist_digest_last_sent_at`` is set, it is used directly

    as the window start rather than falling back to ``now - lookback``: a
    showtime created before that timestamp must not be reported again.
    """
    now = now_amsterdam_naive()
    monkeypatch.setattr(
        "app.services.watchlist_digest.now_amsterdam_naive", lambda: now
    )
    send_calls: list[dict] = []
    monkeypatch.setattr(
        "app.services.watchlist_digest.send_email",
        lambda **kwargs: send_calls.append(kwargs),
    )

    last_sent_at = now - timedelta(hours=2)
    user = user_factory(
        notify_watchlist_digest_frequency=DigestFrequency.DAILY,
        notify_watchlist_digest_last_sent_at=last_sent_at,
    )
    assert user.letterboxd_username is not None

    movie = movie_factory()
    watchlist_crud.add_watchlist_selection(
        session=db_transaction,
        letterboxd_username=user.letterboxd_username,
        letterboxd_slug=movie.letterboxd_slug,
        movie_id=movie.id,
    )

    # Created well within the DAILY lookback window (now - 1 day) but before
    # last_sent_at -> must NOT be reported again, since last_sent_at takes
    # precedence over the lookback fallback.
    showtime_factory(
        movie=movie,
        datetime=now + timedelta(days=2),
        created_at=now - timedelta(hours=6),
    )

    sent = build_and_send_digest(session=db_transaction, user=user)

    assert sent is False
    assert not send_calls
    assert user.notify_watchlist_digest_last_sent_at == last_sent_at
