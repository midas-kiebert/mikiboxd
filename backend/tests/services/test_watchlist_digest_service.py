"""Regression tests for the watchlist new-showtime email digest service.

Covers the two-phase pipeline in ``app/services/watchlist_digest.py``:
``refresh_digest_queue`` (not-listed -> listed transition detection) and
``build_and_send_digest`` (per-user sending, frequency rules, and the
GOING/INTERESTED "already seen" exclusion).
"""

from collections.abc import Callable
from datetime import datetime, timedelta

from sqlmodel import Session

from app.core.enums import DigestFrequency, GoingStatus
from app.crud import watchlist as watchlist_crud
from app.models.cinema import Cinema
from app.models.cinema_preset import CinemaPreset
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


def _create_cinema_preset(
    *,
    session: Session,
    user: User,
    cinema_ids: list[int],
    is_favorite: bool,
    name: str = "Preset",
) -> CinemaPreset:
    preset = CinemaPreset(
        owner_user_id=user.id,
        name=name,
        cinema_ids=cinema_ids,
        is_favorite=is_favorite,
    )
    session.add(preset)
    session.commit()
    return preset


# ---------------------------------------------------------------------------
# refresh_digest_queue
# ---------------------------------------------------------------------------


def _set_listed(*, session: Session, movie: Movie, listed: bool) -> None:
    movie.currently_listed = listed
    session.add(movie)
    session.commit()


def test_movie_becoming_available_is_queued(
    *,
    db_transaction: Session,
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
):
    """A movie that gains a future showtime while not listed is queued."""
    now = now_amsterdam_naive()
    movie = movie_factory()  # currently_listed defaults to False
    showtime_factory(movie=movie, datetime=now + timedelta(days=5))

    queued_count = refresh_digest_queue(session=db_transaction, now=now)

    assert queued_count == 1
    assert db_transaction.get(WatchlistDigestQueueEntry, movie.id) is not None
    db_transaction.refresh(movie)
    assert movie.currently_listed is True


def test_already_listed_movie_is_not_requeued(
    *,
    db_transaction: Session,
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
):
    """A movie already marked listed is not queued again (no transition)."""
    now = now_amsterdam_naive()
    movie = movie_factory()
    showtime_factory(movie=movie, datetime=now + timedelta(days=5))
    _set_listed(session=db_transaction, movie=movie, listed=True)

    queued_count = refresh_digest_queue(session=db_transaction, now=now)

    assert queued_count == 0
    assert db_transaction.get(WatchlistDigestQueueEntry, movie.id) is None


def test_churned_showtime_does_not_requeue_a_listed_movie(
    *,
    db_transaction: Session,
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
):
    """A freshly-created showtime (created_at now) on an already-listed movie —

    e.g. a showtime that was deleted and re-created by scrape churn — must not
    re-queue it. The transition, not showtime created_at, is what matters.
    """
    now = now_amsterdam_naive()
    movie = movie_factory()
    showtime_factory(
        movie=movie,
        datetime=now + timedelta(days=5),
        created_at=now,  # brand-new row, as a churn re-insert would be
    )
    _set_listed(session=db_transaction, movie=movie, listed=True)

    queued_count = refresh_digest_queue(session=db_transaction, now=now)

    assert queued_count == 0
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
    showtime_factory(movie=movie, datetime=now - timedelta(days=1))

    refresh_digest_queue(session=db_transaction, now=now)

    assert db_transaction.get(WatchlistDigestQueueEntry, movie.id) is None


def test_movie_losing_all_future_showtimes_clears_listed_queue_and_notified(
    *,
    db_transaction: Session,
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
    user_factory: Callable[..., User],
):
    """When a listed movie loses its future showtimes, its listed flag, queue

    entry and every user's notified record are cleared so a later reappearance
    counts as new.
    """
    now = now_amsterdam_naive()
    movie = movie_factory()
    showtime_factory(movie=movie, datetime=now - timedelta(days=1))  # only past
    _set_listed(session=db_transaction, movie=movie, listed=True)
    user = user_factory()
    _queue_movie(session=db_transaction, movie_id=movie.id, added_at=now)
    db_transaction.add(
        WatchlistDigestNotifiedMovie(
            user_id=user.id, movie_id=movie.id, notified_at=now
        )
    )
    db_transaction.commit()

    refresh_digest_queue(session=db_transaction, now=now)

    db_transaction.refresh(movie)
    assert movie.currently_listed is False
    assert db_transaction.get(WatchlistDigestQueueEntry, movie.id) is None
    assert db_transaction.get(WatchlistDigestNotifiedMovie, (user.id, movie.id)) is None


def test_reappearing_movie_is_queued_again(
    *,
    db_transaction: Session,
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
):
    """A movie that was cleared (not listed) and gains a future showtime again

    is queued afresh.
    """
    now = now_amsterdam_naive()
    movie = movie_factory()  # currently_listed False (as after being cleared)
    showtime_factory(movie=movie, datetime=now + timedelta(days=2))

    queued_count = refresh_digest_queue(session=db_transaction, now=now)

    assert queued_count == 1
    assert db_transaction.get(WatchlistDigestQueueEntry, movie.id) is not None


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
    monkeypatch.setattr(
        "app.services.watchlist_digest.now_amsterdam_naive", lambda: now
    )
    monkeypatch.setattr(
        "app.services.watchlist_digest.send_email", lambda **kwargs: None
    )

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
    monkeypatch.setattr(
        "app.services.watchlist_digest.now_amsterdam_naive", lambda: now
    )
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


def test_daily_user_is_notified_again_after_the_film_goes_dark_and_returns(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
    monkeypatch,
):
    """Eager is "once per run", not "once forever".

    A film announced months ahead is mailed immediately. When that screening
    has played and nothing has replaced it, the film goes dark and its notified
    record is cleared — so a run announced later is a genuinely new situation
    and is mailed again. What ends the first notification is the film having no
    future showtime at all, not the mailed showtime having passed.
    """
    send_calls: list[dict] = []
    monkeypatch.setattr(
        "app.services.watchlist_digest.send_email",
        lambda **kwargs: send_calls.append(kwargs),
    )

    announced_at = now_amsterdam_naive()
    user = user_factory(notify_watchlist_digest_frequency=DigestFrequency.DAILY)
    movie = movie_factory()
    _add_to_watchlist(session=db_transaction, user=user, movie=movie)
    showtime_factory(movie=movie, datetime=announced_at + timedelta(days=90))

    refresh_digest_queue(session=db_transaction, now=announced_at)
    assert (
        build_and_send_digest(session=db_transaction, user=user, now=announced_at)
        is True
    )
    assert len(send_calls) == 1

    # Four months on, that screening has played and nothing replaced it.
    after_the_run = announced_at + timedelta(days=120)
    refresh_digest_queue(session=db_transaction, now=after_the_run)
    assert db_transaction.get(WatchlistDigestNotifiedMovie, (user.id, movie.id)) is None

    # A new run is announced a month out.
    showtime_factory(movie=movie, datetime=after_the_run + timedelta(days=30))
    refresh_digest_queue(session=db_transaction, now=after_the_run)

    assert (
        build_and_send_digest(session=db_transaction, user=user, now=after_the_run)
        is True
    )
    assert len(send_calls) == 2


def test_movie_not_in_users_source_is_not_sent(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
    monkeypatch,
):
    now = now_amsterdam_naive()
    monkeypatch.setattr(
        "app.services.watchlist_digest.now_amsterdam_naive", lambda: now
    )
    monkeypatch.setattr(
        "app.services.watchlist_digest.send_email", lambda **kwargs: None
    )

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
    monkeypatch.setattr(
        "app.services.watchlist_digest.now_amsterdam_naive", lambda: now
    )
    monkeypatch.setattr(
        "app.services.watchlist_digest.send_email", lambda **kwargs: None
    )

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
    monkeypatch.setattr(
        "app.services.watchlist_digest.now_amsterdam_naive", lambda: now
    )
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
    monkeypatch.setattr(
        "app.services.watchlist_digest.now_amsterdam_naive", lambda: now
    )
    monkeypatch.setattr(
        "app.services.watchlist_digest.send_email", lambda **kwargs: None
    )

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
    assert (
        db_transaction.get(WatchlistDigestNotifiedMovie, (user.id, movie.id))
        is not None
    )


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
    monkeypatch.setattr(
        "app.services.watchlist_digest.now_amsterdam_naive", lambda: now
    )
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
    monkeypatch.setattr(
        "app.services.watchlist_digest.now_amsterdam_naive", lambda: now
    )
    monkeypatch.setattr(
        "app.services.watchlist_digest.send_email", lambda **kwargs: None
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
            going_status=GoingStatus.NOT_GOING,
        )
    )
    db_transaction.commit()

    sent = build_and_send_digest(session=db_transaction, user=user, now=now)

    assert sent is True


# ---------------------------------------------------------------------------
# build_and_send_digest — WEEKLY
# ---------------------------------------------------------------------------

# A fixed Thursday and the day after it, so the weekly send slot is exercised
# without depending on the day the suite happens to run.
_THURSDAY = datetime(2026, 9, 3, 8, 0)
_FRIDAY = datetime(2026, 9, 4, 8, 0)


def _weekly_user(user_factory: Callable[..., User], **kwargs) -> User:
    return user_factory(
        notify_watchlist_digest_frequency=DigestFrequency.WEEKLY_OR_URGENT, **kwargs
    )


def test_weekly_user_is_not_sent_on_a_non_thursday(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
    monkeypatch,
):
    """The weekly digest has a fixed slot; any other day it is simply not due."""
    send_calls: list[dict] = []
    monkeypatch.setattr(
        "app.services.watchlist_digest.send_email",
        lambda **kwargs: send_calls.append(kwargs),
    )

    user = _weekly_user(user_factory, notify_watchlist_digest_last_sent_at=None)
    movie = movie_factory()
    _add_to_watchlist(session=db_transaction, user=user, movie=movie)
    showtime_factory(movie=movie, datetime=_FRIDAY + timedelta(days=1))
    _queue_movie(session=db_transaction, movie_id=movie.id, added_at=_FRIDAY)

    sent = build_and_send_digest(session=db_transaction, user=user, now=_FRIDAY)

    assert sent is False
    assert not send_calls
    assert db_transaction.get(WatchlistDigestNotifiedMovie, (user.id, movie.id)) is None


def test_weekly_user_is_sent_on_thursday_for_a_showtime_inside_the_week(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
    monkeypatch,
):
    monkeypatch.setattr(
        "app.services.watchlist_digest.send_email", lambda **kwargs: None
    )

    user = _weekly_user(user_factory, notify_watchlist_digest_last_sent_at=None)
    movie = movie_factory()
    _add_to_watchlist(session=db_transaction, user=user, movie=movie)
    showtime_factory(movie=movie, datetime=_THURSDAY + timedelta(days=5))
    _queue_movie(session=db_transaction, movie_id=movie.id, added_at=_THURSDAY)

    sent = build_and_send_digest(session=db_transaction, user=user, now=_THURSDAY)

    assert sent is True
    assert user.notify_watchlist_digest_last_sent_at == _THURSDAY


def test_weekly_user_does_not_get_a_showtime_beyond_the_horizon(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
    monkeypatch,
):
    """A film screening further out is held, not sent early and not consumed."""
    send_calls: list[dict] = []
    monkeypatch.setattr(
        "app.services.watchlist_digest.send_email",
        lambda **kwargs: send_calls.append(kwargs),
    )

    user = _weekly_user(user_factory, notify_watchlist_digest_last_sent_at=None)
    movie = movie_factory()
    _add_to_watchlist(session=db_transaction, user=user, movie=movie)
    showtime_factory(movie=movie, datetime=_THURSDAY + timedelta(days=150))
    _queue_movie(session=db_transaction, movie_id=movie.id, added_at=_THURSDAY)

    sent = build_and_send_digest(session=db_transaction, user=user, now=_THURSDAY)

    assert sent is False
    assert not send_calls
    # Still queued and still unnotified: it must surface on a later Thursday.
    assert db_transaction.get(WatchlistDigestNotifiedMovie, (user.id, movie.id)) is None


def test_held_back_film_is_sent_once_a_showtime_falls_inside_the_week(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
    monkeypatch,
):
    """The queue-and-hold case: a film first announced months out is mailed on
    the Thursday a nearer showtime finally appears, without ever being requeued."""
    monkeypatch.setattr(
        "app.services.watchlist_digest.send_email", lambda **kwargs: None
    )

    user = _weekly_user(user_factory, notify_watchlist_digest_last_sent_at=None)
    movie = movie_factory()
    _add_to_watchlist(session=db_transaction, user=user, movie=movie)
    far_showtime = showtime_factory(movie=movie, datetime=_THURSDAY + timedelta(days=60))
    _queue_movie(session=db_transaction, movie_id=movie.id, added_at=_THURSDAY)

    assert build_and_send_digest(session=db_transaction, user=user, now=_THURSDAY) is False

    # A nearer showtime appears; the movie was never requeued, only held.
    next_thursday = _THURSDAY + timedelta(days=7)
    showtime_factory(movie=movie, datetime=next_thursday + timedelta(days=3))

    assert (
        build_and_send_digest(session=db_transaction, user=user, now=next_thursday)
        is True
    )
    assert far_showtime.datetime > next_thursday + timedelta(days=7)
    assert (
        db_transaction.get(WatchlistDigestNotifiedMovie, (user.id, movie.id)) is not None
    )


def test_weekly_user_is_not_sent_twice_on_the_same_thursday(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
    monkeypatch,
):
    """The send job re-running must not produce a second email."""
    send_calls: list[dict] = []
    monkeypatch.setattr(
        "app.services.watchlist_digest.send_email",
        lambda **kwargs: send_calls.append(kwargs),
    )

    user = _weekly_user(
        user_factory, notify_watchlist_digest_last_sent_at=_THURSDAY - timedelta(hours=2)
    )
    movie = movie_factory()
    _add_to_watchlist(session=db_transaction, user=user, movie=movie)
    showtime_factory(movie=movie, datetime=_THURSDAY + timedelta(days=2))
    _queue_movie(session=db_transaction, movie_id=movie.id, added_at=_THURSDAY)

    sent = build_and_send_digest(session=db_transaction, user=user, now=_THURSDAY)

    assert sent is False
    assert not send_calls


def test_daily_user_is_sent_a_showtime_months_away(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
    monkeypatch,
):
    """Eager has no horizon at all — booking months ahead is its whole purpose."""
    monkeypatch.setattr(
        "app.services.watchlist_digest.send_email", lambda **kwargs: None
    )

    user = user_factory(notify_watchlist_digest_frequency=DigestFrequency.DAILY)
    movie = movie_factory()
    _add_to_watchlist(session=db_transaction, user=user, movie=movie)
    showtime_factory(movie=movie, datetime=_FRIDAY + timedelta(days=150))
    _queue_movie(session=db_transaction, movie_id=movie.id, added_at=_FRIDAY)

    sent = build_and_send_digest(session=db_transaction, user=user, now=_FRIDAY)

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
    monkeypatch.setattr(
        "app.services.watchlist_digest.now_amsterdam_naive", lambda: now
    )
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


# ---------------------------------------------------------------------------
# build_and_send_digest — cinema preset filter
# ---------------------------------------------------------------------------


class _FakeEmail:
    subject = "subject"
    html_content = "<p>body</p>"
    text_content = "body"


def test_pinned_cinema_preset_excludes_movie_showing_only_elsewhere(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
    cinema_factory: Callable[..., Cinema],
    monkeypatch,
):
    """A pinned preset drops a movie whose only future showtime is at a cinema
    outside the preset — it is not sent and stays pending."""
    now = now_amsterdam_naive()
    monkeypatch.setattr(
        "app.services.watchlist_digest.now_amsterdam_naive", lambda: now
    )
    send_calls: list[dict] = []
    monkeypatch.setattr(
        "app.services.watchlist_digest.send_email",
        lambda **kwargs: send_calls.append(kwargs),
    )

    user = user_factory(notify_watchlist_digest_frequency=DigestFrequency.DAILY)
    preset_cinema = cinema_factory()
    other_cinema = cinema_factory()
    preset = _create_cinema_preset(
        session=db_transaction,
        user=user,
        cinema_ids=[preset_cinema.id],
        is_favorite=False,
    )
    user.notify_watchlist_digest_cinema_preset_id = preset.id
    db_transaction.add(user)
    db_transaction.commit()

    movie = movie_factory()
    _add_to_watchlist(session=db_transaction, user=user, movie=movie)
    showtime_factory(movie=movie, cinema=other_cinema, datetime=now + timedelta(days=2))
    _queue_movie(session=db_transaction, movie_id=movie.id, added_at=now)

    sent = build_and_send_digest(session=db_transaction, user=user, now=now)

    assert sent is False
    assert not send_calls
    assert db_transaction.get(WatchlistDigestNotifiedMovie, (user.id, movie.id)) is None


def test_pinned_cinema_preset_sends_movie_showing_at_a_preset_cinema(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
    cinema_factory: Callable[..., Cinema],
    monkeypatch,
):
    now = now_amsterdam_naive()
    monkeypatch.setattr(
        "app.services.watchlist_digest.now_amsterdam_naive", lambda: now
    )
    monkeypatch.setattr(
        "app.services.watchlist_digest.send_email", lambda **kwargs: None
    )

    user = user_factory(notify_watchlist_digest_frequency=DigestFrequency.DAILY)
    preset_cinema = cinema_factory()
    preset = _create_cinema_preset(
        session=db_transaction,
        user=user,
        cinema_ids=[preset_cinema.id],
        is_favorite=False,
    )
    user.notify_watchlist_digest_cinema_preset_id = preset.id
    db_transaction.add(user)
    db_transaction.commit()

    movie = movie_factory()
    _add_to_watchlist(session=db_transaction, user=user, movie=movie)
    showtime_factory(
        movie=movie, cinema=preset_cinema, datetime=now + timedelta(days=2)
    )
    _queue_movie(session=db_transaction, movie_id=movie.id, added_at=now)

    sent = build_and_send_digest(session=db_transaction, user=user, now=now)

    assert sent is True
    assert (
        db_transaction.get(WatchlistDigestNotifiedMovie, (user.id, movie.id))
        is not None
    )


def test_no_pinned_preset_falls_back_to_favorite_preset(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
    cinema_factory: Callable[..., Cinema],
    monkeypatch,
):
    """With no preset pinned, the digest follows the user's favorite preset:
    a movie outside it is dropped."""
    now = now_amsterdam_naive()
    monkeypatch.setattr(
        "app.services.watchlist_digest.now_amsterdam_naive", lambda: now
    )
    monkeypatch.setattr(
        "app.services.watchlist_digest.send_email", lambda **kwargs: None
    )

    user = user_factory(notify_watchlist_digest_frequency=DigestFrequency.DAILY)
    favorite_cinema = cinema_factory()
    other_cinema = cinema_factory()
    _create_cinema_preset(
        session=db_transaction,
        user=user,
        cinema_ids=[favorite_cinema.id],
        is_favorite=True,
    )
    # No pinned preset -> notify_watchlist_digest_cinema_preset_id stays None.

    movie = movie_factory()
    _add_to_watchlist(session=db_transaction, user=user, movie=movie)
    showtime_factory(movie=movie, cinema=other_cinema, datetime=now + timedelta(days=2))
    _queue_movie(session=db_transaction, movie_id=movie.id, added_at=now)

    sent = build_and_send_digest(session=db_transaction, user=user, now=now)

    assert sent is False
    assert db_transaction.get(WatchlistDigestNotifiedMovie, (user.id, movie.id)) is None


def test_pinned_preset_overrides_favorite_preset(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
    cinema_factory: Callable[..., Cinema],
    monkeypatch,
):
    """A pinned preset wins over the favorite: a movie at the pinned cinema is
    sent even though it is not in the favorite preset."""
    now = now_amsterdam_naive()
    monkeypatch.setattr(
        "app.services.watchlist_digest.now_amsterdam_naive", lambda: now
    )
    monkeypatch.setattr(
        "app.services.watchlist_digest.send_email", lambda **kwargs: None
    )

    user = user_factory(notify_watchlist_digest_frequency=DigestFrequency.DAILY)
    pinned_cinema = cinema_factory()
    favorite_cinema = cinema_factory()
    _create_cinema_preset(
        session=db_transaction,
        user=user,
        cinema_ids=[favorite_cinema.id],
        is_favorite=True,
        name="Favorite",
    )
    pinned = _create_cinema_preset(
        session=db_transaction,
        user=user,
        cinema_ids=[pinned_cinema.id],
        is_favorite=False,
        name="Pinned",
    )
    user.notify_watchlist_digest_cinema_preset_id = pinned.id
    db_transaction.add(user)
    db_transaction.commit()

    movie = movie_factory()
    _add_to_watchlist(session=db_transaction, user=user, movie=movie)
    showtime_factory(
        movie=movie, cinema=pinned_cinema, datetime=now + timedelta(days=2)
    )
    _queue_movie(session=db_transaction, movie_id=movie.id, added_at=now)

    sent = build_and_send_digest(session=db_transaction, user=user, now=now)

    assert sent is True


def test_no_preset_configured_sends_regardless_of_cinema(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
    cinema_factory: Callable[..., Cinema],
    monkeypatch,
):
    """No pinned and no favorite preset means no cinema restriction at all."""
    now = now_amsterdam_naive()
    monkeypatch.setattr(
        "app.services.watchlist_digest.now_amsterdam_naive", lambda: now
    )
    monkeypatch.setattr(
        "app.services.watchlist_digest.send_email", lambda **kwargs: None
    )

    user = user_factory(notify_watchlist_digest_frequency=DigestFrequency.DAILY)
    movie = movie_factory()
    _add_to_watchlist(session=db_transaction, user=user, movie=movie)
    showtime_factory(
        movie=movie, cinema=cinema_factory(), datetime=now + timedelta(days=2)
    )
    _queue_movie(session=db_transaction, movie_id=movie.id, added_at=now)

    sent = build_and_send_digest(session=db_transaction, user=user, now=now)

    assert sent is True


def test_pinned_preset_picks_the_preset_cinema_showtime_over_an_earlier_one(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
    cinema_factory: Callable[..., Cinema],
    monkeypatch,
):
    """When a movie has an earlier showtime outside the preset and a later one
    inside it, the digest reports the in-preset showtime, not the earlier one."""
    now = now_amsterdam_naive()
    monkeypatch.setattr(
        "app.services.watchlist_digest.now_amsterdam_naive", lambda: now
    )
    monkeypatch.setattr(
        "app.services.watchlist_digest.send_email", lambda **kwargs: None
    )
    captured: dict = {}

    def _capture(*, movie_entries, **_kwargs):
        captured["movie_entries"] = movie_entries
        return _FakeEmail()

    monkeypatch.setattr(
        "app.services.watchlist_digest.generate_watchlist_digest_email", _capture
    )

    user = user_factory(notify_watchlist_digest_frequency=DigestFrequency.DAILY)
    preset_cinema = cinema_factory()
    other_cinema = cinema_factory()
    preset = _create_cinema_preset(
        session=db_transaction,
        user=user,
        cinema_ids=[preset_cinema.id],
        is_favorite=False,
    )
    user.notify_watchlist_digest_cinema_preset_id = preset.id
    db_transaction.add(user)
    db_transaction.commit()

    movie = movie_factory()
    _add_to_watchlist(session=db_transaction, user=user, movie=movie)
    showtime_factory(movie=movie, cinema=other_cinema, datetime=now + timedelta(days=1))
    showtime_factory(
        movie=movie, cinema=preset_cinema, datetime=now + timedelta(days=5)
    )
    _queue_movie(session=db_transaction, movie_id=movie.id, added_at=now)

    sent = build_and_send_digest(session=db_transaction, user=user, now=now)

    assert sent is True
    entries = captured["movie_entries"]
    assert len(entries) == 1
    _, chosen_showtime = entries[0]
    assert chosen_showtime.cinema_id == preset_cinema.id
