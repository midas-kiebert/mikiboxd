"""Watchlist "new showtime" email digest.

Two-phase pipeline, both run daily by the scheduler:

  1. ``refresh_digest_queue`` finds movies that just became "newly available"
     — they have a future showtime now but did not at the previous refresh
     (a not-listed -> listed transition, tracked by ``Movie.currently_listed``)
     — and records each in ``WatchlistDigestQueueEntry``. A movie that stays
     listed is queued only once; a movie that disappears and later returns is
     queued again, because losing all showtimes clears its queue and notified
     records.

  2. ``send_due_digests`` walks every eligible user and evaluates each of
     their ``WatchlistDigestSource`` rows against queue entries matching that
     source's watchlist/list that haven't been sent by *any* of the user's
     sources before (tracked in ``WatchlistDigestNotifiedMovie``, keyed by the
     source that actually sent it — but read across every source the user
     has: once one source has told the user about a film, a slower sibling
     source never re-sends it, even much later on its own schedule). Any such
     movie the user has already marked GOING/INTERESTED on (any of its
     showtimes) is dropped silently — they already know about it — and marked
     notified without ever appearing in an email.

     A user is sent at most one digest email a day: every source due today
     (see ``_should_send_now``) is evaluated, and if more than one has
     something to say they are combined into a single email rather than one
     each, with the same movie appearing once even if more than one source
     surfaced it on the same day (``build_and_send_combined_digest``).

     What's left is sent depending on the source's frequency:
       - DAILY: sent every day there is something pending, with no horizon —
         a film whose only showtime is five months out is mailed today, which
         is the point: it is the setting for booking early.
       - WEEKLY: sent on Thursday mornings only, and restricted to films with
         a showtime in the next seven days. A pending film that is further out
         is *not* dropped and *not* marked notified — it simply waits in the
         queue until one of its showtimes falls inside the window, which may be
         months later.

     Every showtime in a sent email is the movie's next future showtime that
     the frequency's horizon (and the source's cinema restriction) allows;
     once sent, the movie is marked notified for that source and is never
     reconsidered by it again, even if a showtime later changes.
"""

from datetime import datetime, timedelta
from logging import getLogger
from typing import Any
from uuid import UUID

from sqlmodel import Session, col, delete, select, update

from app.core.config import settings
from app.core.enums import DigestFrequency, Environment, GoingStatus
from app.crud import cinema_preset as cinema_preset_crud
from app.crud import movie_set_filters
from app.crud import watchlist_digest_source as sources_crud
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
from app.models.watchlist_digest_source import WatchlistDigestSource
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


def _resolve_source_movie_ids_subquery(
    *, user: User, source: WatchlistDigestSource
) -> Any | None:
    """The movie-id source for this digest source: the list override, or the watchlist."""
    if source.list_id is not None:
        return movie_set_filters.list_movie_ids_subquery([source.list_id])
    if user.letterboxd_username is not None:
        return movie_set_filters.watchlist_movie_ids_subquery(user.letterboxd_username)
    return None


def _resolve_digest_cinemas_label(
    *, session: Session, user: User, source: WatchlistDigestSource
) -> str:
    """Name this source's cinema restriction, for the email footer.

    Mirrors `_resolve_digest_cinema_ids`'s branching exactly (custom ids, then
    the synthetic "All cinemas" row, then a real preset, falling back to no
    restriction), so the label never claims one the send didn't actually
    apply.
    """
    if source.custom_cinema_ids is not None:
        count = len(source.custom_cinema_ids)
        return f"{count} custom cinema{'' if count == 1 else 's'}"
    if source.cinema_preset_id == DEFAULT_CINEMA_PRESET_ID:
        return "All cinemas"
    if source.cinema_preset_id is not None:
        preset = cinema_preset_crud.get_user_preset_by_id(
            session=session, user_id=user.id, preset_id=source.cinema_preset_id
        )
        if preset is not None:
            return preset.name
    return "All cinemas"


def _resolve_digest_source_label(
    *, session: Session, user: User, source: WatchlistDigestSource
) -> DigestSource:
    """Name the list this digest source follows, for the email footer.

    Mirrors the branching in `_resolve_source_movie_ids_subquery` — a chosen
    list wins over the watchlist — so the footer can never credit a source the
    films did not come from. A chosen list whose row has since been deleted
    still filters nothing, so it is named without a link rather than silently
    relabelled as the watchlist.
    """
    cinemas_label = _resolve_digest_cinemas_label(
        session=session, user=user, source=source
    )
    list_id = source.list_id
    if list_id is not None:
        source_list = session.get(LetterboxdList, list_id)
        if source_list is None:
            return DigestSource(
                label="the Letterboxd list you chose",
                url=None,
                frequency=source.frequency,
                cinemas_label=cinemas_label,
            )
        name = source_list.title or source_list.list_slug
        return DigestSource(
            label=f"the Letterboxd list \u201c{name}\u201d",
            url=(
                f"https://letterboxd.com/{source_list.owner}"
                f"/list/{source_list.list_slug}/"
            ),
            frequency=source.frequency,
            cinemas_label=cinemas_label,
        )
    return DigestSource(
        label="your Letterboxd watchlist",
        url=f"https://letterboxd.com/{user.letterboxd_username}/watchlist/",
        frequency=source.frequency,
        cinemas_label=cinemas_label,
    )


def _pending_movie_ids_for_user_source(
    *, session: Session, user_id: UUID, source_subquery: Any
) -> set[int]:
    """Queued movies matching the source that haven't been sent by *any* of
    this user's digest sources before.

    Deliberately not scoped to just this source: a movie an eager source
    already mailed must never resurface months later just because a slower
    (weekly) source of the same user's also happened to be watching it — once
    any source has told the user about it, every sibling source considers it
    done too. `_mark_notified` still records the specific source that
    actually sent it (see `WatchlistDigestNotifiedMovie`'s per-source key),
    but this check reads across all of the user's sources rather than one.
    """
    notified_subquery = (
        select(WatchlistDigestNotifiedMovie.movie_id)
        .join(
            WatchlistDigestSource,
            col(WatchlistDigestSource.id)
            == col(WatchlistDigestNotifiedMovie.source_id),
        )
        .where(col(WatchlistDigestSource.owner_user_id) == user_id)
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


def _resolve_digest_cinema_ids(
    *, session: Session, user: User, source: WatchlistDigestSource
) -> list[int]:
    """Cinema ids this source is restricted to. Empty means no restriction.

    A chosen preset that no longer exists (deleted after being selected)
    is treated the same as no restriction — the column carries no
    DB-level foreign key, and there is no implicit favorite-preset
    fallback at the source level (unlike the old single-source design):
    each source's cinema selection is exactly what it says, nothing more.
    """
    if source.custom_cinema_ids is not None:
        return list(source.custom_cinema_ids)
    if source.cinema_preset_id == DEFAULT_CINEMA_PRESET_ID:
        return []
    if source.cinema_preset_id is not None:
        preset = cinema_preset_crud.get_user_preset_by_id(
            session=session, user_id=user.id, preset_id=source.cinema_preset_id
        )
        if preset is not None:
            return (
                cinema_preset_crud.resolve_preset_cinema_ids(
                    session=session, preset=preset
                )
                or []
            )
    return []


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
    *, session: Session, source_id: UUID, movie_ids: set[int], now: datetime
) -> None:
    for movie_id in movie_ids:
        session.add(
            WatchlistDigestNotifiedMovie(
                source_id=source_id, movie_id=movie_id, notified_at=now
            )
        )


def _should_send_now(*, source: WatchlistDigestSource, now: datetime) -> bool:
    """Whether this source's digest is due today, on frequency alone.

    Deliberately independent of what is pending: WEEKLY is a fixed Thursday
    slot, not "a week since the last one". There is no early send for a
    showtime that is nearly here — a weekly reader has said they want one email
    a week, and a film that sells out between two Thursdays is the cost of
    that. The date check guards against a second send if the job is re-run.
    """
    if source.frequency == DigestFrequency.DAILY:
        return True
    if now.weekday() != _WEEKLY_SEND_WEEKDAY:
        return False
    last_sent_at = source.last_sent_at
    return last_sent_at is None or last_sent_at.date() != now.date()


def _digest_horizon(source: WatchlistDigestSource) -> timedelta | None:
    """How far ahead this source's digest looks. None means no limit."""
    if source.frequency == DigestFrequency.DAILY:
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


def _resolve_source_contribution(
    *,
    session: Session,
    user: User,
    source: WatchlistDigestSource,
    now: datetime,
) -> tuple[set[int], list[tuple[Movie, Showtime]]] | None:
    """What one source would add to today's digest, if anything.

    Returns ``None`` if the source has nothing to send (not due, no watchlist
    to fall back on, nothing pending, or nothing left after already-marked
    movies are dropped) — the caller can skip it without any special-casing.
    Movies the user already marked GOING/INTERESTED on are dropped and marked
    notified here regardless, exactly as before combining: that housekeeping
    doesn't depend on whether this source ends up contributing to an email.

    Returns ``(sent_movie_ids, movie_entries)``: ``sent_movie_ids`` is what
    this source should mark notified for itself once *some* email is sent
    (whether or not every one of those movies survives the cross-source
    dedupe in the combined entry list) — a movie this source is done with
    must never be reconsidered by it again just because another source also
    happened to carry it.
    """
    if not _should_send_now(source=source, now=now):
        return None

    source_subquery = _resolve_source_movie_ids_subquery(user=user, source=source)
    if source_subquery is None:
        return None

    pending_movie_ids = _pending_movie_ids_for_user_source(
        session=session, user_id=user.id, source_subquery=source_subquery
    )
    if not pending_movie_ids:
        return None

    already_interested_ids = _movie_ids_with_user_interest(
        session=session, user_id=user.id, movie_ids=pending_movie_ids
    )
    if already_interested_ids:
        _mark_notified(
            session=session,
            source_id=source.id,
            movie_ids=already_interested_ids,
            now=now,
        )
        session.commit()

    candidate_ids = pending_movie_ids - already_interested_ids
    if not candidate_ids:
        return None

    cinema_ids = _resolve_digest_cinema_ids(session=session, user=user, source=source)
    movie_entries = _resolve_movie_entries(
        session=session,
        movie_ids=candidate_ids,
        cinema_ids=cinema_ids,
        now=now,
        horizon=_digest_horizon(source),
    )
    if not movie_entries:
        return None

    sent_movie_ids = {movie.id for movie, _ in movie_entries}
    return sent_movie_ids, movie_entries


def build_and_send_combined_digest(
    *,
    session: Session,
    user: User,
    sources: list[WatchlistDigestSource],
    now: datetime | None = None,
) -> bool:
    """Evaluate every one of the user's sources and send at most one combined
    email covering whichever of them are due and have something to say today.

    Returns whether an email was sent.
    """
    reference_time = now or now_amsterdam_naive()

    contributions: list[
        tuple[WatchlistDigestSource, set[int], list[tuple[Movie, Showtime]]]
    ] = []
    for source in sources:
        contribution = _resolve_source_contribution(
            session=session, user=user, source=source, now=reference_time
        )
        if contribution is not None:
            sent_movie_ids, movie_entries = contribution
            contributions.append((source, sent_movie_ids, movie_entries))

    if not contributions:
        return False

    # The same film can surface via more than one source (e.g. it's on both
    # the watchlist and a chosen list) — shown once, keeping whichever
    # source's cinema restriction found it the soonest showtime.
    merged_entries: dict[int, tuple[Movie, Showtime]] = {}
    for _, _, movie_entries in contributions:
        for movie, showtime in movie_entries:
            existing = merged_entries.get(movie.id)
            if existing is None or showtime.datetime < existing[1].datetime:
                merged_entries[movie.id] = (movie, showtime)
    combined_entries = sorted(
        merged_entries.values(), key=lambda pair: pair[0].title.lower()
    )

    email_data = generate_watchlist_digest_email(
        email_to=user.email,
        movie_entries=combined_entries,
        sources=[
            _resolve_digest_source_label(session=session, user=user, source=source)
            for source, _, _ in contributions
        ],
        now=reference_time,
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

    for source, sent_movie_ids, _ in contributions:
        _mark_notified(
            session=session,
            source_id=source.id,
            movie_ids=sent_movie_ids,
            now=reference_time,
        )
        source.last_sent_at = reference_time
        session.add(source)
    session.commit()
    return True


def send_due_digests(*, session: Session, now: datetime | None = None) -> int:
    """Send each eligible user at most one combined digest email.
    Returns the number of emails sent."""
    reference_time = now or now_amsterdam_naive()
    users = session.exec(
        select(User).where(col(User.notify_watchlist_digest_enabled).is_(True))
    ).all()

    sent_count = 0
    for user in users:
        if not _is_eligible(user):
            continue
        sources = sources_crud.list_user_sources(session=session, user_id=user.id)
        if build_and_send_combined_digest(
            session=session, user=user, sources=sources, now=reference_time
        ):
            sent_count += 1
    return sent_count
