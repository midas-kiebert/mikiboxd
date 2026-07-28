from uuid import UUID

from sqlmodel import Session

from app.crud import movie as movies_crud
from app.crud import user as users_crud
from app.crud import watchlist as watchlist_crud
from app.exceptions.scraper_exceptions import LetterboxdTemporarilyUnavailable
from app.exceptions.user_exceptions import (
    LetterboxdUsernameNotSet,
    UserNotFound,
)
from app.exceptions.watchlist_exceptions import WatchlistSyncTooSoon
from app.models.user import User
from app.scraping.letterboxd.watchlist import get_watchlist as scrape_watchlist
from app.services.letterboxd_sync import is_within_cooldown
from app.utils import now_amsterdam_naive


def clear_watchlist(*, session: Session, user_id: UUID) -> None:
    letterboxd_username = users_crud.get_letterboxd_username(
        session=session,
        user_id=user_id,
    )
    if not letterboxd_username:
        raise LetterboxdUsernameNotSet
    selections = watchlist_crud.get_watchlist_selections(
        session=session,
        letterboxd_username=letterboxd_username,
    )

    for selection in selections:
        session.delete(selection)


def sync_watchlist(
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
        last_sync=user.letterboxd.last_watchlist_sync,
        last_attempt=user.letterboxd.last_watchlist_sync_attempt,
    ):
        raise WatchlistSyncTooSoon()

    # Committed up front so the backoff survives a scrape that raises.
    user.letterboxd.last_watchlist_sync_attempt = now_amsterdam_naive()
    session.commit()

    result = scrape_watchlist(user.letterboxd_username)
    if not result.is_complete:
        # The stored rows are replaced wholesale below, so a partial scrape
        # would drop films the user still has on their watchlist.
        raise LetterboxdTemporarilyUnavailable(
            "Letterboxd only returned part of your watchlist. Keeping the "
            "previous data; it will sync again shortly."
        )

    clear_watchlist(
        session=session,
        user_id=user_id,
    )

    letterboxd_username = users_crud.get_letterboxd_username(
        session=session,
        user_id=user_id,
    )

    if not letterboxd_username:
        raise LetterboxdUsernameNotSet()

    for slug in result.slugs:
        movie = movies_crud.get_movie_by_letterboxd_slug(
            session=session,
            letterboxd_slug=slug,
        )

        watchlist_crud.add_watchlist_selection(
            session=session,
            letterboxd_username=letterboxd_username,
            letterboxd_slug=slug,
            movie_id=movie.id if movie else None,
        )

    user.letterboxd.last_watchlist_sync = now_amsterdam_naive()
    session.commit()
