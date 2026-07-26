"""Sync watchlist and watched data for every user with a Letterboxd username set.

One-off run to refresh all users' cached Letterboxd data (e.g. after scraper
changes or an extended outage). Skips users whose data was already synced in
the last 10 minutes, and continues past per-user scraping failures.
"""

import time

from sqlmodel import col, select

from app.api.deps import get_db_context
from app.exceptions.base import AppError
from app.models.user import User
from app.services.watched import sync_watched
from app.services.watchlist import sync_watchlist

SLEEP_BETWEEN_USERS_SECONDS = 2

with get_db_context() as session:
    user_ids = session.exec(
        select(User.id).where(col(User.letterboxd_username).is_not(None))
    ).all()

    print(f"Found {len(user_ids)} users with a Letterboxd username set")

    watchlist_ok = watchlist_failed = 0
    watched_ok = watched_failed = 0

    for user_id in user_ids:
        try:
            sync_watchlist(session=session, user_id=user_id)
            watchlist_ok += 1
        except AppError as e:
            session.rollback()
            watchlist_failed += 1
            print(f"[watchlist] {user_id}: {e.detail}")
        except Exception as e:
            session.rollback()
            watchlist_failed += 1
            print(f"[watchlist] {user_id}: unexpected error: {e}")

        time.sleep(SLEEP_BETWEEN_USERS_SECONDS)

        try:
            sync_watched(session=session, user_id=user_id)
            watched_ok += 1
        except AppError as e:
            session.rollback()
            watched_failed += 1
            print(f"[watched] {user_id}: {e.detail}")
        except Exception as e:
            session.rollback()
            watched_failed += 1
            print(f"[watched] {user_id}: unexpected error: {e}")

        time.sleep(SLEEP_BETWEEN_USERS_SECONDS)

    print(
        f"Watchlist: {watchlist_ok} ok, {watchlist_failed} failed. "
        f"Watched: {watched_ok} ok, {watched_failed} failed."
    )
