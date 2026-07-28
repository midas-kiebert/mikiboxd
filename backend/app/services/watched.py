from collections.abc import Iterable
from datetime import timedelta
from uuid import UUID

from sqlmodel import Session

from app.crud import movie as movies_crud
from app.crud import user as users_crud
from app.crud import watched as watched_crud
from app.exceptions.scraper_exceptions import LetterboxdTemporarilyUnavailable
from app.exceptions.user_exceptions import (
    LetterboxdUsernameNotSet,
    UserNotFound,
)
from app.exceptions.watchlist_exceptions import WatchedSyncTooSoon
from app.models.letterboxd import Letterboxd
from app.models.user import User
from app.scraping.letterboxd.rss import get_recent_watched_slugs
from app.scraping.letterboxd.watched import get_watched as scrape_watched
from app.services.letterboxd_sync import is_within_cooldown
from app.utils import now_amsterdam_naive

# How long the cheap RSS top-up may stand in for a full walk of /films/.
# Every full walk costs one request per ~72 films; the feed costs exactly one.
WATCHED_FULL_RESYNC_INTERVAL = timedelta(days=7)


def _is_full_resync_due(letterboxd: Letterboxd) -> bool:
    """Whether the next sync must walk every /films/ page.

    The RSS fast path only ever adds slugs, so un-watches and films marked
    watched without a diary entry are only reconciled by a full walk.
    """
    last_full_sync = letterboxd.last_watched_full_sync
    if last_full_sync is None:
        return True
    return now_amsterdam_naive() - last_full_sync >= WATCHED_FULL_RESYNC_INTERVAL


def _add_missing_watched_selections(
    *,
    session: Session,
    letterboxd_username: str,
    slugs: Iterable[str],
    known_slugs: set[str],
) -> int:
    """Insert the slugs we do not already store. Returns how many were added."""
    added = 0
    for slug in slugs:
        if slug in known_slugs:
            continue
        movie = movies_crud.get_movie_by_letterboxd_slug(
            session=session,
            letterboxd_slug=slug,
        )
        watched_crud.add_watched_selection(
            session=session,
            letterboxd_username=letterboxd_username,
            letterboxd_slug=slug,
            movie_id=movie.id if movie else None,
        )
        known_slugs.add(slug)
        added += 1
    return added


def clear_watched(*, session: Session, user_id: UUID) -> None:
    letterboxd_username = users_crud.get_letterboxd_username(
        session=session,
        user_id=user_id,
    )
    if not letterboxd_username:
        raise LetterboxdUsernameNotSet
    selections = watched_crud.get_watched_selections(
        session=session,
        letterboxd_username=letterboxd_username,
    )

    for selection in selections:
        session.delete(selection)


def sync_watched(
    *,
    session: Session,
    user_id: UUID,
) -> None:
    user = session.get(User, user_id)
    if not user:
        raise UserNotFound(user_id)
    if not user.letterboxd or not user.letterboxd_username:
        raise LetterboxdUsernameNotSet()

    # Checked before the scrape: doing it afterwards means the throttled caller
    # has already cost us the full paginated fetch, which is the traffic the
    # cooldown exists to prevent.
    if is_within_cooldown(
        last_sync=user.letterboxd.last_watched_sync,
        last_attempt=user.letterboxd.last_watched_sync_attempt,
    ):
        raise WatchedSyncTooSoon()

    # Committed up front so the backoff survives a scrape that raises.
    user.letterboxd.last_watched_sync_attempt = now_amsterdam_naive()
    session.commit()

    letterboxd_username = user.letterboxd_username
    known_slugs = {
        selection.letterboxd_slug
        for selection in watched_crud.get_watched_selections(
            session=session,
            letterboxd_username=letterboxd_username,
        )
    }

    # Rows stored before their film reached our catalog stay unlinked forever
    # otherwise: nothing else ever revisits movie_id, and only a linked row
    # counts as watched. Run unconditionally, ahead of both paths below, so a
    # user's watched list self-heals as soon as the catalog catches up -
    # regardless of which path this sync takes. Costs one UPDATE, no
    # Letterboxd traffic.
    watched_crud.relink_watched_selections_to_catalog(
        session=session,
        letterboxd_username=letterboxd_username,
    )

    # Fast path: one RSS request instead of a page-per-72-films walk. Only
    # viable once we already hold a full list to top up, and only until the
    # full-resync interval comes round.
    if known_slugs and not _is_full_resync_due(user.letterboxd):
        recent_slugs = get_recent_watched_slugs(letterboxd_username)
        if recent_slugs is not None:
            _add_missing_watched_selections(
                session=session,
                letterboxd_username=letterboxd_username,
                slugs=recent_slugs,
                known_slugs=known_slugs,
            )
            user.letterboxd.last_watched_sync = now_amsterdam_naive()
            session.commit()
            return
        # Feed unusable: fall through to the full walk rather than skipping the
        # sync, so a member with no feed still gets their watched list.

    result = scrape_watched(letterboxd_username)
    if not result.is_complete:
        # The stored rows are replaced wholesale below, so a partial scrape
        # would delete films the user has watched and mark the result synced.
        raise LetterboxdTemporarilyUnavailable(
            "Letterboxd only returned part of your watched list. Keeping the "
            "previous data; it will sync again shortly."
        )

    clear_watched(
        session=session,
        user_id=user_id,
    )

    _add_missing_watched_selections(
        session=session,
        letterboxd_username=letterboxd_username,
        slugs=result.slugs,
        known_slugs=set(),
    )

    synced_at = now_amsterdam_naive()
    user.letterboxd.last_watched_sync = synced_at
    user.letterboxd.last_watched_full_sync = synced_at
    session.commit()
