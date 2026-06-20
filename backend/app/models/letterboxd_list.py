"""Letterboxd list models.

A :class:`LetterboxdList` is a *shared* cache of a Letterboxd list (e.g.
``letterboxd.com/official/list/letterboxds-top-500-films/``). Unlike the
per-user watchlist/watched tables, a list is identified by its
``(owner, list_slug)`` and reused across every user who references it, so it is
scraped once and cached. :class:`LetterboxdListFilm` holds the scraped film
slugs, and :class:`UserLetterboxdList` links a user to the lists they follow.
"""

import uuid
from datetime import datetime

from sqlmodel import Field, SQLModel, UniqueConstraint


class LetterboxdList(SQLModel, table=True):
    __table_args__ = (
        UniqueConstraint("owner", "list_slug", name="uq_letterboxd_list_owner_slug"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    owner: str = Field(index=True)
    list_slug: str
    title: str | None = None
    boxd_shortcode: str | None = None
    is_curated: bool = Field(default=False, nullable=False)
    last_updated_on_letterboxd: datetime | None = None
    last_synced: datetime | None = None


class LetterboxdListFilm(SQLModel, table=True):
    list_id: uuid.UUID = Field(
        foreign_key="letterboxdlist.id", ondelete="CASCADE", primary_key=True
    )
    letterboxd_slug: str = Field(primary_key=True)
    movie_id: int | None = Field(default=None, foreign_key="movie.id")


class UserLetterboxdList(SQLModel, table=True):
    user_id: uuid.UUID = Field(
        foreign_key="user.id", ondelete="CASCADE", primary_key=True
    )
    list_id: uuid.UUID = Field(
        foreign_key="letterboxdlist.id", ondelete="CASCADE", primary_key=True
    )
