from datetime import datetime, timedelta
from uuid import UUID

from sqlmodel import Session

from app.crud import movie as movies_crud
from app.crud import watchlist as watchlist_crud
from app.exceptions.user_exceptions import (
    LetterboxdUsernameNotSet,
    UserNotFound,
)
from app.exceptions.watchlist_exceptions import WatchlistSyncTooSoon
from app.models.user import User
from app.scraping.letterboxd.watchlist import get_watchlist as scrape_watchlist
from app.utils import now_amsterdam_naive


def clear_watchlist(*, session: Session, user_id: UUID) -> None:
    selections = watchlist_crud.get_watchlist_selections(
        session=session,
        user_id=user_id,
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
    watchlist_slugs = scrape_watchlist(user.letterboxd_username)

    last_sync = user.letterboxd.last_watchlist_sync

    if last_sync and datetime.utcnow() - last_sync < timedelta(minutes=10):
        raise WatchlistSyncTooSoon()

    clear_watchlist(
        session=session,
        user_id=user_id,
    )

    for slug in watchlist_slugs:
        movie = movies_crud.get_movie_by_letterboxd_slug(
            session=session,
            letterboxd_slug=slug,
        )
        if movie is None:
            continue

        watchlist_crud.add_watchlist_selection(
            session=session,
            user_id=user_id,
            movie_id=movie.id,
        )

    user.letterboxd.last_watchlist_sync = now_amsterdam_naive()
    session.commit()
