"""Regression tests for the watchlist new-showtime email digest service.

Covers the two-phase pipeline in ``app/services/watchlist_digest.py``:
``refresh_digest_queue`` (global, once-ever "newly available" detection) and
``build_and_send_digest`` (per-user sending, frequency rules, and the
GOING/INTERESTED "already seen" exclusion).
"""

from collections.abc import Callable
from datetime import timedelta

from sqlmodel import Session

from app.core.enums import DigestFrequency, GoingStatus
from app.crud import watchlist as watchlist_crud
from app.models.movie import Movie
from app.models.showtime import Showtime
from app.models.showtime_selection import ShowtimeSelection
from app.models.user import User
from app.models.watchlist_digest_notified_movie import WatchlistDigestNotifiedMovie
from app.models.watchlist_digest_queue_entry import WatchlistDigestQueueEntry
from app.services.watchlist_digest import build_and_send_digest, refresh_digest_queue
from app.utils import now_amsterdam_naive


def _add_to_watchlist(*, session: Session, user: User, movie: Movie) -> None:
    assert user.letterboxd_username is not None
    assert movie.letterboxd_slug is not None
    watchlist_crud.add_watchlist_selection(
        session=session,
        letterboxd_username=user.letterboxd_username,
        letterboxd_slug=movie.letterboxd_slug,
        movie_id=movie.id,
    )


def _queue_movie(*, session: Session, movie_id: int, added_at) -> None:
    session.add(WatchlistDigestQueueEntry(movie_id=movie_id, added_at=added_at))
    session.commit()


# ---------------------------------------------------------------------------
# refresh_digest_queue
# ---------------------------------------------------------------------------


def test_movie_with_only_new_future_showtime_is_queued(
    *,
    db_transaction: Session,
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
):
    """A movie whose only-ever showtime was just inserted is queued."""
    now = now_amsterdam_naive()
    movie = movie_factory()
    showtime_factory(
        movie=movie,
        datetime=now + timedelta(days=5),
        created_at=now - timedelta(hours=1),
    )

    queued_count = refresh_digest_queue(session=db_transaction, now=now)

    assert queued_count == 1
    entry = db_transaction.get(WatchlistDigestQueueEntry, movie.id)
    assert entry is not None


def test_movie_with_only_pre_cutoff_future_showtime_is_not_queued(
    *,
    db_transaction: Session,
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
):
    """A showtime created long ago that is still upcoming is already known."""
    now = now_amsterdam_naive()
    movie = movie_factory()
    showtime_factory(
        movie=movie,
        datetime=now + timedelta(days=5),
        created_at=now - timedelta(days=30),
    )

    refresh_digest_queue(session=db_transaction, now=now)

    assert db_transaction.get(WatchlistDigestQueueEntry, movie.id) is None


def test_movie_with_only_past_showtime_is_not_queued(
    *,
    db_transaction: Session,
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
):
    """No current future showtime at all means it cannot be "newly available"."""
    now = now_amsterdam_naive()
    movie = movie_factory()
    showtime_factory(
        movie=movie,
        datetime=now - timedelta(days=1),
        created_at=now - timedelta(hours=1),
    )

    refresh_digest_queue(session=db_transaction, now=now)

    assert db_transaction.get(WatchlistDigestQueueEntry, movie.id) is None


def test_movie_with_old_aired_showtime_plus_new_future_one_is_not_queued(
    *,
    db_transaction: Session,
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
):
    """A movie that already had a showtime — even one that has since aired —

    must not be queued just because it later receives a brand-new showtime.
    """
    now = now_amsterdam_naive()
    movie = movie_factory()
    showtime_factory(
        movie=movie,
        datetime=now - timedelta(days=10),
        created_at=now - timedelta(days=30),
    )
    showtime_factory(
        movie=movie,
        datetime=now + timedelta(days=3),
        created_at=now - timedelta(hours=1),
    )

    refresh_digest_queue(session=db_transaction, now=now)

    assert db_transaction.get(WatchlistDigestQueueEntry, movie.id) is None


def test_movie_already_queued_is_not_queued_again(
    *,
    db_transaction: Session,
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
):
    """A movie can only ever enter the queue once."""
    now = now_amsterdam_naive()
    movie = movie_factory()
    showtime_factory(
        movie=movie,
        datetime=now + timedelta(days=5),
        created_at=now - timedelta(hours=1),
    )
    original_added_at = now - timedelta(days=2)
    _queue_movie(session=db_transaction, movie_id=movie.id, added_at=original_added_at)

    queued_count = refresh_digest_queue(session=db_transaction, now=now)

    assert queued_count == 0
    entry = db_transaction.get(WatchlistDigestQueueEntry, movie.id)
    assert entry is not None
    assert entry.added_at == original_added_at


# ---------------------------------------------------------------------------
# build_and_send_digest — DAILY
# ---------------------------------------------------------------------------


def test_daily_user_is_sent_a_pending_queued_movie(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
    monkeypatch,
):
    now = now_amsterdam_naive()
    monkeypatch.setattr("app.services.watchlist_digest.now_amsterdam_naive", lambda: now)
    monkeypatch.setattr("app.services.watchlist_digest.send_email", lambda **kwargs: None)

    user = user_factory(notify_watchlist_digest_frequency=DigestFrequency.DAILY)
    movie = movie_factory()
    _add_to_watchlist(session=db_transaction, user=user, movie=movie)
    showtime_factory(movie=movie, datetime=now + timedelta(days=2))
    _queue_movie(session=db_transaction, movie_id=movie.id, added_at=now)

    sent = build_and_send_digest(session=db_transaction, user=user, now=now)

    assert sent is True
    assert user.notify_watchlist_digest_last_sent_at == now
    notified = db_transaction.get(WatchlistDigestNotifiedMovie, (user.id, movie.id))
    assert notified is not None


def test_daily_user_is_not_resent_an_already_notified_movie(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
    monkeypatch,
):
    now = now_amsterdam_naive()
    monkeypatch.setattr("app.services.watchlist_digest.now_amsterdam_naive", lambda: now)
    send_calls: list[dict] = []
    monkeypatch.setattr(
        "app.services.watchlist_digest.send_email",
        lambda **kwargs: send_calls.append(kwargs),
    )

    user = user_factory(notify_watchlist_digest_frequency=DigestFrequency.DAILY)
    movie = movie_factory()
    _add_to_watchlist(session=db_transaction, user=user, movie=movie)
    showtime_factory(movie=movie, datetime=now + timedelta(days=2))
    _queue_movie(session=db_transaction, movie_id=movie.id, added_at=now)
    db_transaction.add(
        WatchlistDigestNotifiedMovie(
            user_id=user.id, movie_id=movie.id, notified_at=now - timedelta(hours=1)
        )
    )
    db_transaction.commit()

    sent = build_and_send_digest(session=db_transaction, user=user, now=now)

    assert sent is False
    assert not send_calls


def test_movie_not_in_users_source_is_not_sent(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
    monkeypatch,
):
    now = now_amsterdam_naive()
    monkeypatch.setattr("app.services.watchlist_digest.now_amsterdam_naive", lambda: now)
    monkeypatch.setattr("app.services.watchlist_digest.send_email", lambda **kwargs: None)

    user = user_factory(notify_watchlist_digest_frequency=DigestFrequency.DAILY)
    movie = movie_factory()  # not added to the user's watchlist
    showtime_factory(movie=movie, datetime=now + timedelta(days=2))
    _queue_movie(session=db_transaction, movie_id=movie.id, added_at=now)

    sent = build_and_send_digest(session=db_transaction, user=user, now=now)

    assert sent is False


def test_movie_with_no_current_future_showtime_is_not_sent_or_marked_notified(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
    monkeypatch,
):
    """A queued movie whose showtime is no longer upcoming stays pending."""
    now = now_amsterdam_naive()
    monkeypatch.setattr("app.services.watchlist_digest.now_amsterdam_naive", lambda: now)
    monkeypatch.setattr("app.services.watchlist_digest.send_email", lambda **kwargs: None)

    user = user_factory(notify_watchlist_digest_frequency=DigestFrequency.DAILY)
    movie = movie_factory()
    _add_to_watchlist(session=db_transaction, user=user, movie=movie)
    showtime_factory(movie=movie, datetime=now - timedelta(days=1))
    _queue_movie(session=db_transaction, movie_id=movie.id, added_at=now)

    sent = build_and_send_digest(session=db_transaction, user=user, now=now)

    assert sent is False
    assert db_transaction.get(WatchlistDigestNotifiedMovie, (user.id, movie.id)) is None


def test_movie_whose_only_showtime_is_deleted_before_send_stays_pending(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
    monkeypatch,
):
    """If the showtime that queued a movie is deleted before the digest runs,

    the movie is skipped (not sent, not marked notified) rather than emailed
    with a dangling reference — it stays pending for a future run.
    """
    now = now_amsterdam_naive()
    monkeypatch.setattr("app.services.watchlist_digest.now_amsterdam_naive", lambda: now)
    send_calls: list[dict] = []
    monkeypatch.setattr(
        "app.services.watchlist_digest.send_email",
        lambda **kwargs: send_calls.append(kwargs),
    )

    user = user_factory(notify_watchlist_digest_frequency=DigestFrequency.DAILY)
    movie = movie_factory()
    _add_to_watchlist(session=db_transaction, user=user, movie=movie)
    showtime = showtime_factory(movie=movie, datetime=now + timedelta(days=2))
    _queue_movie(session=db_transaction, movie_id=movie.id, added_at=now)
    db_transaction.delete(showtime)
    db_transaction.commit()

    sent = build_and_send_digest(session=db_transaction, user=user, now=now)

    assert sent is False
    assert not send_calls
    assert db_transaction.get(WatchlistDigestNotifiedMovie, (user.id, movie.id)) is None


def test_movie_with_one_of_two_showtimes_deleted_is_still_sent_with_the_other(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
    monkeypatch,
):
    """Deleting the soonest showtime falls back to the movie's next one, rather

    than skipping the movie entirely.
    """
    now = now_amsterdam_naive()
    monkeypatch.setattr("app.services.watchlist_digest.now_amsterdam_naive", lambda: now)
    monkeypatch.setattr("app.services.watchlist_digest.send_email", lambda **kwargs: None)

    user = user_factory(notify_watchlist_digest_frequency=DigestFrequency.DAILY)
    movie = movie_factory()
    _add_to_watchlist(session=db_transaction, user=user, movie=movie)
    soonest = showtime_factory(movie=movie, datetime=now + timedelta(days=1))
    showtime_factory(movie=movie, datetime=now + timedelta(days=5))
    _queue_movie(session=db_transaction, movie_id=movie.id, added_at=now)
    db_transaction.delete(soonest)
    db_transaction.commit()

    sent = build_and_send_digest(session=db_transaction, user=user, now=now)

    assert sent is True
    assert db_transaction.get(WatchlistDigestNotifiedMovie, (user.id, movie.id)) is not None


def test_movie_already_marked_going_is_excluded_and_marked_notified(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
    monkeypatch,
):
    """A movie the user already marked GOING on is silently dropped, not sent."""
    now = now_amsterdam_naive()
    monkeypatch.setattr("app.services.watchlist_digest.now_amsterdam_naive", lambda: now)
    send_calls: list[dict] = []
    monkeypatch.setattr(
        "app.services.watchlist_digest.send_email",
        lambda **kwargs: send_calls.append(kwargs),
    )

    user = user_factory(notify_watchlist_digest_frequency=DigestFrequency.DAILY)
    movie = movie_factory()
    _add_to_watchlist(session=db_transaction, user=user, movie=movie)
    showtime = showtime_factory(movie=movie, datetime=now + timedelta(days=2))
    _queue_movie(session=db_transaction, movie_id=movie.id, added_at=now)
    db_transaction.add(
        ShowtimeSelection(
            user_id=user.id,
            showtime_id=showtime.id,
            going_status=GoingStatus.GOING,
        )
    )
    db_transaction.commit()

    sent = build_and_send_digest(session=db_transaction, user=user, now=now)

    assert sent is False
    assert not send_calls
    notified = db_transaction.get(WatchlistDigestNotifiedMovie, (user.id, movie.id))
    assert notified is not None


def test_movie_marked_not_going_is_not_excluded(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
    monkeypatch,
):
    """NOT_GOING does not count as "already seen" — only GOING/INTERESTED do."""
    now = now_amsterdam_naive()
    monkeypatch.setattr("app.services.watchlist_digest.now_amsterdam_naive", lambda: now)
    monkeypatch.setattr("app.services.watchlist_digest.send_email", lambda **kwargs: None)

    user = user_factory(notify_watchlist_digest_frequency=DigestFrequency.DAILY)
    movie = movie_factory()
    _add_to_watchlist(session=db_transaction, user=user, movie=movie)
    showtime = showtime_factory(movie=movie, datetime=now + timedelta(days=2))
    _queue_movie(session=db_transaction, movie_id=movie.id, added_at=now)
    db_transaction.add(
        ShowtimeSelection(
            user_id=user.id,
            showtime_id=showtime.id,
            going_status=GoingStatus.NOT_GOING,
        )
    )
    db_transaction.commit()

    sent = build_and_send_digest(session=db_transaction, user=user, now=now)

    assert sent is True


# ---------------------------------------------------------------------------
# build_and_send_digest — WEEKLY_OR_URGENT
# ---------------------------------------------------------------------------


def test_weekly_user_with_no_urgency_and_recent_send_is_held_back(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
    monkeypatch,
):
    now = now_amsterdam_naive()
    monkeypatch.setattr("app.services.watchlist_digest.now_amsterdam_naive", lambda: now)
    send_calls: list[dict] = []
    monkeypatch.setattr(
        "app.services.watchlist_digest.send_email",
        lambda **kwargs: send_calls.append(kwargs),
    )

    user = user_factory(
        notify_watchlist_digest_frequency=DigestFrequency.WEEKLY_OR_URGENT,
        notify_watchlist_digest_last_sent_at=now - timedelta(days=2),
    )
    movie = movie_factory()
    _add_to_watchlist(session=db_transaction, user=user, movie=movie)
    # Showtime is more than 3 days out -> not urgent.
    showtime_factory(movie=movie, datetime=now + timedelta(days=10))
    _queue_movie(session=db_transaction, movie_id=movie.id, added_at=now)

    sent = build_and_send_digest(session=db_transaction, user=user, now=now)

    assert sent is False
    assert not send_calls
    assert db_transaction.get(WatchlistDigestNotifiedMovie, (user.id, movie.id)) is None


def test_weekly_user_with_urgent_showtime_is_sent_immediately(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
    monkeypatch,
):
    now = now_amsterdam_naive()
    monkeypatch.setattr("app.services.watchlist_digest.now_amsterdam_naive", lambda: now)
    monkeypatch.setattr("app.services.watchlist_digest.send_email", lambda **kwargs: None)

    user = user_factory(
        notify_watchlist_digest_frequency=DigestFrequency.WEEKLY_OR_URGENT,
        notify_watchlist_digest_last_sent_at=now - timedelta(days=2),
    )
    movie = movie_factory()
    _add_to_watchlist(session=db_transaction, user=user, movie=movie)
    # Showtime is within 3 days -> urgent, overrides the recent last-send.
    showtime_factory(movie=movie, datetime=now + timedelta(days=1))
    _queue_movie(session=db_transaction, movie_id=movie.id, added_at=now)

    sent = build_and_send_digest(session=db_transaction, user=user, now=now)

    assert sent is True
    assert user.notify_watchlist_digest_last_sent_at == now


def test_weekly_user_with_no_urgency_but_stale_last_send_is_sent(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
    monkeypatch,
):
    now = now_amsterdam_naive()
    monkeypatch.setattr("app.services.watchlist_digest.now_amsterdam_naive", lambda: now)
    monkeypatch.setattr("app.services.watchlist_digest.send_email", lambda **kwargs: None)

    user = user_factory(
        notify_watchlist_digest_frequency=DigestFrequency.WEEKLY_OR_URGENT,
        notify_watchlist_digest_last_sent_at=now - timedelta(days=8),
    )
    movie = movie_factory()
    _add_to_watchlist(session=db_transaction, user=user, movie=movie)
    showtime_factory(movie=movie, datetime=now + timedelta(days=10))
    _queue_movie(session=db_transaction, movie_id=movie.id, added_at=now)

    sent = build_and_send_digest(session=db_transaction, user=user, now=now)

    assert sent is True


def test_weekly_user_never_sent_before_is_sent_immediately(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
    monkeypatch,
):
    now = now_amsterdam_naive()
    monkeypatch.setattr("app.services.watchlist_digest.now_amsterdam_naive", lambda: now)
    monkeypatch.setattr("app.services.watchlist_digest.send_email", lambda **kwargs: None)

    user = user_factory(
        notify_watchlist_digest_frequency=DigestFrequency.WEEKLY_OR_URGENT,
        notify_watchlist_digest_last_sent_at=None,
    )
    movie = movie_factory()
    _add_to_watchlist(session=db_transaction, user=user, movie=movie)
    showtime_factory(movie=movie, datetime=now + timedelta(days=10))
    _queue_movie(session=db_transaction, movie_id=movie.id, added_at=now)

    sent = build_and_send_digest(session=db_transaction, user=user, now=now)

    assert sent is True


def test_send_failure_does_not_mark_movie_notified(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
    monkeypatch,
):
    def _raise():
        raise RuntimeError("smtp down")

    now = now_amsterdam_naive()
    monkeypatch.setattr("app.services.watchlist_digest.now_amsterdam_naive", lambda: now)
    monkeypatch.setattr("app.services.watchlist_digest.send_email", _raise)

    user = user_factory(notify_watchlist_digest_frequency=DigestFrequency.DAILY)
    movie = movie_factory()
    _add_to_watchlist(session=db_transaction, user=user, movie=movie)
    showtime_factory(movie=movie, datetime=now + timedelta(days=2))
    _queue_movie(session=db_transaction, movie_id=movie.id, added_at=now)

    sent = build_and_send_digest(session=db_transaction, user=user, now=now)

    assert sent is False
    assert db_transaction.get(WatchlistDigestNotifiedMovie, (user.id, movie.id)) is None
    assert user.notify_watchlist_digest_last_sent_at is None
