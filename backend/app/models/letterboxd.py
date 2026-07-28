"""Letterboxd account model — tracks linked accounts and their last watchlist sync time."""

from datetime import datetime

from sqlmodel import Field, SQLModel


class Letterboxd(SQLModel, table=True):
    letterboxd_username: str = Field(primary_key=True)
    last_watchlist_sync: datetime | None
    last_watched_sync: datetime | None = None
    # Stamped before each scrape, so a sync that keeps failing (Letterboxd
    # throttling the /films/ endpoint, say) still backs off instead of retrying
    # on every app foreground. A NULL success timestamp alone cannot do that.
    last_watchlist_sync_attempt: datetime | None = None
    last_watched_sync_attempt: datetime | None = None
    # Last *full* paginated walk of /films/. The routine sync only tops up from
    # the RSS feed, which cannot see un-watches or films marked watched without
    # a diary entry, so a periodic full walk is what reconciles those.
    last_watched_full_sync: datetime | None = None
