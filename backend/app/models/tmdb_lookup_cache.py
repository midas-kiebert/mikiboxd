import datetime as dt

from sqlalchemy import UniqueConstraint
from sqlmodel import Field, SQLModel

__all__ = [
    "TmdbLookupCache",
]


class TmdbLookupCache(SQLModel, table=True):
    __table_args__ = (
        UniqueConstraint(
            "lookup_hash",
            "lookup_payload",
            name="uq_tmdblookupcache_hash_payload",
        ),
    )
    id: int = Field(primary_key=True)
    lookup_hash: str = Field(index=True)
    lookup_payload: str
    tmdb_id: int | None = None
    created_at: dt.datetime = Field(index=True)
    updated_at: dt.datetime = Field(index=True)
