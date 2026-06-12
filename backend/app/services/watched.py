from datetime import datetime, timedelta
from uuid import UUID

from sqlmodel import Session

from app.crud import movie as movies_crud
from app.crud import user as users_crud
from app.crud import watched as watched_crud
from app.exceptions.user_exceptions import (
    LetterboxdUsernameNotSet,
    UserNotFound,
)
from app.exceptions.watchlist_exceptions import WatchedSyncTooSoon
from app.models.user import User
from app.scraping.letterboxd.watched import get_watched as scrape_watched
from app.utils import now_amsterdam_naive


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
    watched_slugs = scrape_watched(user.letterboxd_username)

    last_sync = user.letterboxd.last_watched_sync

    if last_sync and datetime.utcnow() - last_sync < timedelta(minutes=10):
        raise WatchedSyncTooSoon()

    clear_watched(
        session=session,
        user_id=user_id,
    )

    letterboxd_username = users_crud.get_letterboxd_username(
        session=session,
        user_id=user_id,
    )

    if not letterboxd_username:
        raise LetterboxdUsernameNotSet()

    for slug in watched_slugs:
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

    user.letterboxd.last_watched_sync = now_amsterdam_naive()
    session.commit()
