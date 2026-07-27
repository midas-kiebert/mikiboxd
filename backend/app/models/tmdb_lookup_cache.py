"""TMDB lookup cache — deduplicates movie identity lookups against the TMDB API."""

import datetime as dt

from sqlalchemy import UniqueConstraint
from sqlmodel import Field, SQLModel


class TmdbLookupCache(SQLModel, table=True):
    __table_args__ = (
        UniqueConstraint(
            "lookup_hash",
            "lookup_payload",
            name="uq_tmdblookupcache_hash_payload",
        ),
    )
    id: int | None = Field(default=None, primary_key=True)
    lookup_hash: str = Field(index=True)
    lookup_payload: str
    # The normalized title the payload was built from, denormalized out of
    # `lookup_payload` into its own indexed column. The hash keys on the *whole*
    # payload — cast, runtime and spoken languages included — all of which come
    # from the cinema's listing and change without the film changing. When that
    # happens the row is missed and the lookup starts from scratch, which is how
    # a hand-corrected film silently went wrong again. This is what lets a
    # manual correction still be found across that drift.
    title_query: str | None = Field(default=None, index=True)
    tmdb_id: int | None = None
    confidence: float | None = None
    # Set when an admin fixed this row by hand. Automated lookups must never
    # overwrite it, and it is what a drifted payload falls back to.
    is_manual_override: bool = Field(default=False)
    created_at: dt.datetime = Field(index=True)
    updated_at: dt.datetime = Field(index=True)
