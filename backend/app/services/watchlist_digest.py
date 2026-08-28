"""Watchlist "new showtime" email digest.

Two-phase pipeline, both run daily by the scheduler:

  1. ``refresh_digest_queue`` finds movies that just became "newly available"
     — they have a future showtime now but did not at the previous refresh
     (a not-listed -> listed transition, tracked by ``Movie.currently_listed``)
     — and records each in ``WatchlistDigestQueueEntry``. A movie that stays
     listed is queued only once; a movie that disappears and later returns is
     queued again, because losing all showtimes clears its queue and notified
     records.

  2. ``send_due_digests`` walks every eligible user and, for each one, looks
     at queue entries matching their watchlist/list source that haven't been
     sent to *that user* before (tracked in ``WatchlistDigestNotifiedMovie``).
     Any such movie the user has already marked GOING/INTERESTED on (any of
     its showtimes) is dropped silently — they already know about it — and
     marked notified without ever appearing in an email.

     What's left is sent depending on frequency:
       - DAILY: sent every day there is something pending, with no horizon —
         a film whose only showtime is five months out is mailed today, which
         is the point: it is the setting for booking early.
       - WEEKLY: sent on Thursday mornings only, and restricted to films with
         a showtime in the next seven days. A pending film that is further out
         is *not* dropped and *not* marked notified — it simply waits in the
         queue until one of its showtimes falls inside the window, which may be
         months later.

     Every showtime in a sent email is the movie's next future showtime that
     the frequency's horizon allows; once sent, the movie is marked notified
     for that user and is never reconsidered, even if a showtime later changes.
"""

from datetime import datetime, timedelta
from logging import getLogger
from typing import Any

from sqlmodel import Session, col, delete, select, update

from app.core.config import settings
from app.core.enums import DigestFrequency, Environment, GoingStatus
from app.crud import cinema_preset as cinema_preset_crud
from app.crud import movie_set_filters
from app.mailer import (
    DigestSource,
    EmailDeliveryError,
    generate_watchlist_digest_email,
    send_email,
)
from app.models.cinema_preset import DEFAULT_CINEMA_PRESET_ID
from app.models.letterboxd_list import LetterboxdList
from app.models.movie import Movie
from app.models.showtime import Showtime
from app.models.showtime_selection import ShowtimeSelection
from app.models.user import User
from app.models.watchlist_digest_notified_movie import WatchlistDigestNotifiedMovie
from app.models.watchlist_digest_queue_entry import WatchlistDigestQueueEntry
from app.utils import now_amsterdam_naive

logger = getLogger(__name__)

# How far ahead a WEEKLY digest looks. Films outside it stay queued rather than
# being sent early, so a weekly reader only ever sees what is actually coming up.
_WEEKLY_HORIZON = timedelta(days=7)
# Thursday, as `datetime.weekday()` numbers it: the day Dutch cinemas normally
# publish the new week's programme, so it is the day with the most to report.
_WEEKLY_SEND_WEEKDAY = 3


def refresh_digest_queue(*, session: Session, now: datetime | None = None) -> int:
    """Detect movies that just became available and add them to the digest queue.

    "Newly available" means a not-listed -> listed transition: the movie has a
    future showtime now but did not at the previous refresh (tracked by the
    persistent ``Movie.currently_listed`` flag). This intentionally re-triggers
    for a movie that disappeared and later came back, while a movie that stays
    listed — including one whose showtimes were merely deleted and re-created by
    scrape churn — is only ever queued once per genuine appearance.

    When a movie stops being listed, its queue entry and every user's notified
    record for it are cleared, so a future reappearance notifies afresh.

    Returns the number of movies newly queued.
    """
    reference_time = now or now_amsterdam_naive()

    rows = session.exec(select(Showtime.movie_id, Showtime.datetime)).all()
    available_now: set[int] = {
        movie_id
        for movie_id, showtime_datetime in rows
        if showtime_datetime > reference_time
    }

    movie_states = session.exec(select(Movie.id, Movie.currently_listed)).all()
    became_available: set[int] = set()
    became_unavailable: set[int] = set()
    for movie_id, currently_listed in movie_states:
        is_available = movie_id in available_now
        if is_available and not currently_listed:
            became_available.add(movie_id)
        elif not is_available and currently_listed:
            became_unavailable.add(movie_id)

    if became_available:
        session.execute(
            update(Movie)
            .where(col(Movie.id).in_(became_available))
            .values(currently_listed=True)
        )
        for movie_id in became_available:
            session.add(
                WatchlistDigestQueueEntry(movie_id=movie_id, added_at=reference_time)
            )
    if became_unavailable:
        session.execute(
            update(Movie)
            .where(col(Movie.id).in_(became_unavailable))
            .values(currently_listed=False)
        )
        # Clear queue + per-user notified history so a later reappearance is
        # treated as a fresh arrival.
        session.execute(
            delete(WatchlistDigestQueueEntry).where(
                col(WatchlistDigestQueueEntry.movie_id).in_(became_unavailable)
            )
        )
        session.execute(
            delete(WatchlistDigestNotifiedMovie).where(
                col(WatchlistDigestNotifiedMovie.movie_id).in_(became_unavailable)
            )
        )
    if became_available or became_unavailable:
        session.commit()
    return len(became_available)


def _resolve_source_movie_ids_subquery(user: User) -> Any | None:
    """The movie-id source for the digest: the list override, or the watchlist."""
    if user.notify_watchlist_digest_list_id is not None:
        return movie_set_filters.list_movie_ids_subquery(
            [user.notify_watchlist_digest_list_id]
        )
    if user.letterboxd_username is not None:
        return movie_set_filters.watchlist_movie_ids_subquery(user.letterboxd_username)
    return None


def _resolve_digest_source(*, session: Session, user: User) -> DigestSource:
    """Name the list this user's digest follows, for the email footer.

    Mirrors the branching in `_resolve_source_movie_ids_subquery` — a chosen
    list wins over the watchlist — so the footer can never credit a source the
    films did not come from. A chosen list whose row has since been deleted
    still filters nothing, so it is named without a link rather than silently
    relabelled as the watchlist.
    """
    list_id = user.notify_watchlist_digest_list_id
    if list_id is not None:
        source_list = session.get(LetterboxdList, list_id)
        if source_list is None:
            return DigestSource(label="the Letterboxd list you chose", url=None)
        name = source_list.title or source_list.list_slug
        return DigestSource(
            label=f"the Letterboxd list \u201c{name}\u201d",
            url=(
                f"https://letterboxd.com/{source_list.owner}"
                f"/list/{source_list.list_slug}/"
            ),
        )
    return DigestSource(
        label="your Letterboxd watchlist",
        url=f"https://letterboxd.com/{user.letterboxd_username}/watchlist/",
    )


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
    if preset_id == DEFAULT_CINEMA_PRESET_ID:
        # The "All Cinemas" preset is synthesised per request by
        # `list_cinema_presets` and has no row to look up, so this used to fall
        # through to the favorite — quietly restricting a digest the user had
        # asked to cover everything. The mobile picker no longer offers it, but
        # accounts that chose it while it did still carry the id.
        return []
    if preset_id is not None:
        preset = cinema_preset_crud.get_user_preset_by_id(
            session=session, user_id=user.id, preset_id=preset_id
        )
        if preset is not None:
            return (
                cinema_preset_crud.resolve_preset_cinema_ids(
                    session=session, preset=preset
                )
                or []
            )
    return cinema_preset_crud.get_favorite_cinema_ids(session=session, user_id=user.id)


def _resolve_movie_entries(
    *,
    session: Session,
    movie_ids: set[int],
    cinema_ids: list[int],
    now: datetime,
    horizon: timedelta | None,
) -> list[tuple[Movie, Showtime]]:
    """Pair each movie with its current next future showtime, dropping any movie

    that no longer has one. When ``cinema_ids`` is non-empty, only showtimes at
    those cinemas are considered — a movie showing solely elsewhere is dropped.
    When ``horizon`` is set, showtimes beyond it are ignored too, which drops
    the movie from this send without marking it notified: the caller leaves it
    queued for a later week.
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
        if horizon is not None:
            stmt = stmt.where(col(Showtime.datetime) <= now + horizon)
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


def _should_send_now(*, user: User, now: datetime) -> bool:
    """Whether this user's digest is due today, on frequency alone.

    Deliberately independent of what is pending: WEEKLY is a fixed Thursday
    slot, not "a week since the last one". There is no early send for a
    showtime that is nearly here — a weekly reader has said they want one email
    a week, and a film that sells out between two Thursdays is the cost of
    that. The date check guards against a second send if the job is re-run.
    """
    if user.notify_watchlist_digest_frequency == DigestFrequency.DAILY:
        return True
    if now.weekday() != _WEEKLY_SEND_WEEKDAY:
        return False
    last_sent_at = user.notify_watchlist_digest_last_sent_at
    return last_sent_at is None or last_sent_at.date() != now.date()


def _digest_horizon(user: User) -> timedelta | None:
    """How far ahead this user's digest looks. None means no limit."""
    if user.notify_watchlist_digest_frequency == DigestFrequency.DAILY:
        return None
    return _WEEKLY_HORIZON


def _is_eligible(user: User) -> bool:
    if not user.notify_watchlist_digest_enabled:
        return False
    # Belt and braces on the check in `update_me`: whatever turned the switch on
    # (an older client, a flag set before this rule existed), recurring mail
    # only ever goes to an address someone has proven they can read.
    if not user.email_verified:
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
    if not _should_send_now(user=user, now=reference_time):
        return False

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
        horizon=_digest_horizon(user),
    )
    if not movie_entries:
        return False

    movie_entries.sort(key=lambda pair: pair[0].title.lower())

    email_data = generate_watchlist_digest_email(
        email_to=user.email,
        movie_entries=movie_entries,
        frequency=user.notify_watchlist_digest_frequency,
        source=_resolve_digest_source(session=session, user=user),
    )
    try:
        send_email(
            email_to=user.email,
            subject=email_data.subject,
            html_content=email_data.html_content,
            text_content=email_data.text_content,
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
