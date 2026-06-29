"""Watchlist "new showtime" email digest.

Two-phase pipeline, both run daily by the scheduler:

  1. ``refresh_digest_queue`` finds movies that just became "newly available"
     — they now have at least one future showtime, but had no showtime at
     all (past or future) as of 24 hours ago — and records each one, once,
     forever, in ``WatchlistDigestQueueEntry``. A movie can only ever enter
     the queue a single time.

  2. ``send_due_digests`` walks every eligible user and, for each one, looks
     at queue entries matching their watchlist/list source that haven't been
     sent to *that user* before (tracked in ``WatchlistDigestNotifiedMovie``).
     Any such movie the user has already marked GOING/INTERESTED on (any of
     its showtimes) is dropped silently — they already know about it — and
     marked notified without ever appearing in an email.

     What's left is sent depending on frequency:
       - DAILY: sent immediately, every day there's something pending.
       - WEEKLY_OR_URGENT: held back until either one of the pending movies
         has a showtime within 3 days, or it's been more than a week since
         the last digest — whichever comes first.

     Every showtime in a sent email is the movie's current next future
     showtime; once sent, the movie is marked notified for that user and is
     never reconsidered, even if the showtime later changes.
"""

from datetime import datetime, timedelta
from logging import getLogger
from typing import Any

from sqlmodel import Session, col, select

from app.core.config import settings
from app.core.enums import DigestFrequency, Environment, GoingStatus
from app.crud import cinema_preset as cinema_preset_crud
from app.crud import movie_set_filters
from app.mailer import EmailDeliveryError, generate_watchlist_digest_email, send_email
from app.models.movie import Movie
from app.models.showtime import Showtime
from app.models.showtime_selection import ShowtimeSelection
from app.models.user import User
from app.models.watchlist_digest_notified_movie import WatchlistDigestNotifiedMovie
from app.models.watchlist_digest_queue_entry import WatchlistDigestQueueEntry
from app.utils import now_amsterdam_naive

logger = getLogger(__name__)

_DISCOVERY_LOOKBACK = timedelta(days=1)
_URGENT_WITHIN = timedelta(days=3)
_WEEKLY_MAX_WAIT = timedelta(days=7)


def refresh_digest_queue(*, session: Session, now: datetime | None = None) -> int:
    """Detect newly-available movies and add them to the digest queue.

    A movie qualifies once: it currently has a future showtime and had no
    showtime at all — past or future — created more than 24 hours ago.
    Returns the number of movies newly queued.
    """
    reference_time = now or now_amsterdam_naive()
    cutoff = reference_time - _DISCOVERY_LOOKBACK

    rows = session.exec(
        select(Showtime.movie_id, Showtime.datetime, Showtime.created_at)
    ).all()

    future_movie_ids: set[int] = set()
    had_showtime_before_cutoff: set[int] = set()
    for movie_id, showtime_datetime, created_at in rows:
        if showtime_datetime > reference_time:
            future_movie_ids.add(movie_id)
        if created_at < cutoff:
            had_showtime_before_cutoff.add(movie_id)

    already_queued_ids = set(
        session.exec(select(WatchlistDigestQueueEntry.movie_id)).all()
    )

    newly_available_ids = (
        future_movie_ids - had_showtime_before_cutoff - already_queued_ids
    )
    for movie_id in newly_available_ids:
        session.add(
            WatchlistDigestQueueEntry(movie_id=movie_id, added_at=reference_time)
        )
    if newly_available_ids:
        session.commit()
    return len(newly_available_ids)


def _resolve_source_movie_ids_subquery(user: User) -> Any | None:
    """The movie-id source for the digest: the list override, or the watchlist."""
    if user.notify_watchlist_digest_list_id is not None:
        return movie_set_filters.list_movie_ids_subquery(
            [user.notify_watchlist_digest_list_id]
        )
    if user.letterboxd_username is not None:
        return movie_set_filters.watchlist_movie_ids_subquery(user.letterboxd_username)
    return None


def _pending_movie_ids_for_user(
    *, session: Session, user_id: Any, source_subquery: Any
) -> set[int]:
    """Queued movies matching the user's source that haven't been sent to them."""
    notified_subquery = select(WatchlistDigestNotifiedMovie.movie_id).where(
        col(WatchlistDigestNotifiedMovie.user_id) == user_id
    )
    return set(
        session.exec(
            select(WatchlistDigestQueueEntry.movie_id).where(
                col(WatchlistDigestQueueEntry.movie_id).in_(source_subquery),
                col(WatchlistDigestQueueEntry.movie_id).not_in(notified_subquery),
            )
        ).all()
    )


def _movie_ids_with_user_interest(
    *, session: Session, user_id: Any, movie_ids: set[int]
) -> set[int]:
    """Movies the user already marked GOING/INTERESTED on (any showtime)."""
    if not movie_ids:
        return set()
    return set(
        session.exec(
            select(Showtime.movie_id)
            .join(
                ShowtimeSelection,
                col(ShowtimeSelection.showtime_id) == col(Showtime.id),
            )
            .where(
                col(Showtime.movie_id).in_(movie_ids),
                col(ShowtimeSelection.user_id) == user_id,
                col(ShowtimeSelection.going_status).in_(
                    [GoingStatus.GOING, GoingStatus.INTERESTED]
                ),
            )
        ).all()
    )


def _resolve_digest_cinema_ids(*, session: Session, user: User) -> list[int]:
    """Cinema ids the digest is restricted to: the user's chosen preset, else
    their favorite preset. Empty means no cinema restriction.

    A chosen preset that no longer exists (deleted after being selected) falls
    back to the favorite — the column carries no DB-level foreign key.
    """
    preset_id = user.notify_watchlist_digest_cinema_preset_id
    if preset_id is not None:
        preset = cinema_preset_crud.get_user_preset_by_id(
            session=session, user_id=user.id, preset_id=preset_id
        )
        if preset is not None:
            return list(preset.cinema_ids)
    return cinema_preset_crud.get_favorite_cinema_ids(session=session, user_id=user.id)


def _resolve_movie_entries(
    *, session: Session, movie_ids: set[int], cinema_ids: list[int], now: datetime
) -> list[tuple[Movie, Showtime]]:
    """Pair each movie with its current next future showtime, dropping any movie

    that no longer has one. When ``cinema_ids`` is non-empty, only showtimes at
    those cinemas are considered — a movie showing solely elsewhere is dropped.
    """
    if not movie_ids:
        return []
    movies = session.exec(select(Movie).where(col(Movie.id).in_(movie_ids))).all()
    entries: list[tuple[Movie, Showtime]] = []
    for movie in movies:
        stmt = select(Showtime).where(
            col(Showtime.movie_id) == movie.id,
            col(Showtime.datetime) > now,
        )
        if cinema_ids:
            stmt = stmt.where(col(Showtime.cinema_id).in_(cinema_ids))
        next_showtime = session.exec(
            stmt.order_by(col(Showtime.datetime).asc())
        ).first()
        if next_showtime is not None:
            entries.append((movie, next_showtime))
    return entries


def _mark_notified(
    *, session: Session, user_id: Any, movie_ids: set[int], now: datetime
) -> None:
    for movie_id in movie_ids:
        session.add(
            WatchlistDigestNotifiedMovie(
                user_id=user_id, movie_id=movie_id, notified_at=now
            )
        )


def _should_send_now(
    *,
    user: User,
    movie_entries: list[tuple[Movie, Showtime]],
    now: datetime,
) -> bool:
    if user.notify_watchlist_digest_frequency == DigestFrequency.DAILY:
        return True
    has_urgent_showtime = any(
        showtime.datetime - now < _URGENT_WITHIN for _, showtime in movie_entries
    )
    last_sent_at = user.notify_watchlist_digest_last_sent_at
    week_elapsed = last_sent_at is None or (now - last_sent_at) > _WEEKLY_MAX_WAIT
    return has_urgent_showtime or week_elapsed


def _is_eligible(user: User) -> bool:
    if not user.notify_watchlist_digest_enabled:
        return False
    # Outside production this only goes to superusers, so the feature can be
    # tested on dev/staging before opening it up to everyone in production.
    if settings.ENVIRONMENT != Environment.PRODUCTION and not user.is_superuser:
        return False
    return True


def build_and_send_digest(
    *, session: Session, user: User, now: datetime | None = None
) -> bool:
    """Evaluate and, if due, send one user's digest. Returns whether an email was sent."""
    source_subquery = _resolve_source_movie_ids_subquery(user)
    if source_subquery is None:
        return False

    reference_time = now or now_amsterdam_naive()

    pending_movie_ids = _pending_movie_ids_for_user(
        session=session, user_id=user.id, source_subquery=source_subquery
    )
    if not pending_movie_ids:
        return False

    already_interested_ids = _movie_ids_with_user_interest(
        session=session, user_id=user.id, movie_ids=pending_movie_ids
    )
    if already_interested_ids:
        _mark_notified(
            session=session,
            user_id=user.id,
            movie_ids=already_interested_ids,
            now=reference_time,
        )
        session.commit()

    candidate_ids = pending_movie_ids - already_interested_ids
    if not candidate_ids:
        return False

    cinema_ids = _resolve_digest_cinema_ids(session=session, user=user)
    movie_entries = _resolve_movie_entries(
        session=session,
        movie_ids=candidate_ids,
        cinema_ids=cinema_ids,
        now=reference_time,
    )
    if not movie_entries:
        return False

    if not _should_send_now(user=user, movie_entries=movie_entries, now=reference_time):
        return False

    movie_entries.sort(key=lambda pair: pair[0].title.lower())

    email_data = generate_watchlist_digest_email(
        email_to=user.email,
        movie_entries=movie_entries,
    )
    try:
        send_email(
            email_to=user.email,
            subject=email_data.subject,
            html_content=email_data.html_content,
        )
    except (AssertionError, EmailDeliveryError, Exception):
        logger.exception("Failed sending watchlist digest email to %s", user.email)
        return False

    sent_movie_ids = {movie.id for movie, _ in movie_entries}
    _mark_notified(
        session=session,
        user_id=user.id,
        movie_ids=sent_movie_ids,
        now=reference_time,
    )
    user.notify_watchlist_digest_last_sent_at = reference_time
    session.add(user)
    session.commit()
    return True


def send_due_digests(*, session: Session, now: datetime | None = None) -> int:
    """Send every eligible, due user their digest. Returns the number sent."""
    reference_time = now or now_amsterdam_naive()
    users = session.exec(
        select(User).where(col(User.notify_watchlist_digest_enabled).is_(True))
    ).all()

    sent_count = 0
    for user in users:
        if not _is_eligible(user):
            continue
        if build_and_send_digest(session=session, user=user, now=reference_time):
            sent_count += 1
    return sent_count
