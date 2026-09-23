"""Raw log of every event (screening) the Cineville API lists.

Kept apart from showtimes on purpose: it covers every Cineville venue, needs no
TMDB match, and is never deleted when a screening passes. Cineville stamps each
event with its own `createdAt`/`updatedAt`, which says when a cinema published a
screening far more precisely than our scrape cadence could — this table is what
the admin publish-timing view reads.

`first_seen_at`/`last_seen_at` are our own sweeps; `gone_at` is set when a sweep
no longer lists an upcoming event (cleared if it comes back). Rows written by
`scripts/backfill-cineville-events.py` have no `first_seen_at`, since we never
saw them live.
"""

import datetime as dt

from sqlmodel import Field, SQLModel


class CinevilleEvent(SQLModel, table=True):
    # Cineville's event UUID.
    id: str = Field(primary_key=True)
    venue_id: str = Field(index=True)
    venue_name: str
    # Our cinema for this venue, when we have one. No foreign key: the log
    # should survive a cinema being removed.
    cinema_id: int | None = Field(default=None, index=True)
    production_id: str | None = None
    title: str | None = None
    start_at: dt.datetime = Field(index=True)
    is_hidden: bool = False
    source_created_at: dt.datetime = Field(index=True)
    source_updated_at: dt.datetime
    first_seen_at: dt.datetime | None = None
    last_seen_at: dt.datetime | None = None
    gone_at: dt.datetime | None = None
