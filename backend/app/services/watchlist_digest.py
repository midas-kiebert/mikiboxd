"""Watchlist "new showtime" email digest.

Sends a periodic email to a user listing movies (from their watchlist, or an
optional Letterboxd list override) that are "newly available": they now have
an upcoming showtime, and none of their current upcoming showtimes existed
before the start of the lookback window. This is deliberately stricter than
"a showtime was added" — a movie that was already on the agenda and gets an
additional showtime does not count, and a showtime that aged into the past
(and was removed) can never make a movie look newly available again, since
the comparison always runs against currently-future showtimes.
"""

from datetime import datetime, timedelta
from logging import getLogger
from typing import Any

from sqlmodel import Session, col, select

from app.core.config import settings
from app.core.enums import DigestFrequency, Environment
from app.crud import movie_set_filters
from app.mailer import EmailDeliveryError, generate_watchlist_digest_email, send_email
from app.models.movie import Movie
from app.models.showtime import Showtime
from app.models.user import User
from app.utils import now_amsterdam_naive

logger = getLogger(__name__)

_LOOKBACK_BY_FREQUENCY = {
    DigestFrequency.DAILY: timedelta(days=1),
    DigestFrequency.WEEKLY: timedelta(days=7),
}


def _resolve_source_movie_ids_subquery(user: User) -> Any | None:
    """The movie-id source for the digest: the list override, or the watchlist."""
    if user.notify_watchlist_digest_list_id is not None:
        return movie_set_filters.list_movie_ids_subquery(
            [user.notify_watchlist_digest_list_id]
        )
    if user.letterboxd_username is not None:
        return movie_set_filters.watchlist_movie_ids_subquery(user.letterboxd_username)
    return None


def _find_newly_available_movie_ids(
    *,
    session: Session,
    source_subquery: Any,
    now: datetime,
    window_start: datetime,
) -> set[int]:
    rows = session.exec(
        select(Showtime.movie_id, Showtime.created_at).where(
            col(Showtime.movie_id).in_(source_subquery),
            col(Showtime.datetime) > now,
        )
    ).all()

    future_movie_ids: set[int] = set()
    had_future_showtime_before_window: set[int] = set()
    for movie_id, created_at in rows:
        future_movie_ids.add(movie_id)
        if created_at < window_start:
            had_future_showtime_before_window.add(movie_id)

    return future_movie_ids - had_future_showtime_before_window


def _is_eligible(user: User, *, now: datetime) -> bool:
    if not user.notify_watchlist_digest_enabled:
        return False
    # Outside production this only goes to superusers, so the feature can be
    # tested on dev/staging before opening it up to everyone in production.
    if settings.ENVIRONMENT != Environment.PRODUCTION and not user.is_superuser:
        return False
    if (
        user.notify_watchlist_digest_frequency == DigestFrequency.WEEKLY
        and now.weekday() != 0
    ):
        return False
    return True


def build_and_send_digest(*, session: Session, user: User) -> bool:
    """Build and send one user's digest. Returns whether an email was sent."""
    source_subquery = _resolve_source_movie_ids_subquery(user)
    if source_subquery is None:
        return False

    now = now_amsterdam_naive()
    lookback = _LOOKBACK_BY_FREQUENCY[user.notify_watchlist_digest_frequency]
    window_start = user.notify_watchlist_digest_last_sent_at or (now - lookback)

    newly_available_ids = _find_newly_available_movie_ids(
        session=session,
        source_subquery=source_subquery,
        now=now,
        window_start=window_start,
    )
    if not newly_available_ids:
        return False

    movies = list(
        session.exec(select(Movie).where(col(Movie.id).in_(newly_available_ids))).all()
    )

    movie_entries: list[tuple[Movie, Showtime]] = []
    for movie in movies:
        next_showtime = session.exec(
            select(Showtime)
            .where(
                col(Showtime.movie_id) == movie.id,
                col(Showtime.datetime) > now,
            )
            .order_by(col(Showtime.datetime).asc())
        ).first()
        if next_showtime is None:
            continue
        movie_entries.append((movie, next_showtime))

    if not movie_entries:
        return False

    movie_entries.sort(key=lambda pair: pair[0].title.lower())

    email_data = generate_watchlist_digest_email(
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

    user.notify_watchlist_digest_last_sent_at = now
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
        if not _is_eligible(user, now=reference_time):
            continue
        if build_and_send_digest(session=session, user=user):
            sent_count += 1
    return sent_count
