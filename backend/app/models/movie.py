"""Movie models."""

import re
from datetime import datetime

from sqlalchemy import String
from sqlalchemy.dialects.postgresql import ARRAY
from sqlmodel import Column, Field, SQLModel

# Real movies use their TMDB id as the primary key (always positive). Synthetic
# listings that have no TMDB counterpart (e.g. sneak previews, where the film is
# deliberately secret) get negative ids instead, so they never collide with a
# TMDB id and are trivially distinguishable everywhere with `id < 0`.
SNEAK_PREVIEW_MOVIE_ID = -1
SNEAK_PREVIEW_TITLE = "Sneak Preview"

_SNEAK_PREVIEW_RE = re.compile(r"\bsneak\s*preview", re.IGNORECASE)


def is_synthetic_movie_id(movie_id: int) -> bool:
    """Whether a movie id refers to a synthetic (non-TMDB) listing."""
    return movie_id < 0


def is_sneak_preview_title(title: str | None) -> bool:
    """Detect a sneak-preview listing from its (cinema-provided) title."""
    if not title:
        return False
    return _SNEAK_PREVIEW_RE.search(title) is not None


# Shared properties
class MovieBase(SQLModel):
    id: int = Field(
        unique=True,
        index=True,
        primary_key=True,
    )
    title: str
    original_title: str | None = None
    poster_link: str | None = None
    letterboxd_slug: str | None = None
    directors: list[str] | None = Field(sa_column=Column(ARRAY(String)), default=None)
    cast: list[str] | None = Field(sa_column=Column(ARRAY(String)), default=None)
    release_year: int | None = None
    duration: int | None = None
    languages: list[str] | None = Field(sa_column=Column(ARRAY(String)), default=None)
    original_language: str | None = None


# Properties to receive on movie creation
class MovieCreate(MovieBase):
    tmdb_last_enriched_at: datetime | None = None


# Properties to receive on movie update
class MovieUpdate(SQLModel):
    title: str | None = None
    poster_link: str | None = None
    letterboxd_slug: str | None = None
    duration: int | None = None
    languages: list[str] | None = None
    original_language: str | None = None
    cast: list[str] | None = None
    tmdb_last_enriched_at: datetime | None = None


# Database model, database table inferred from class name
class Movie(MovieBase, table=True):
    tmdb_last_enriched_at: datetime | None = None


def sneak_preview_movie() -> MovieCreate:
    """The single synthetic movie all sneak-preview showtimes attach to.

    Cinemas keep the actual film secret, so every metadata field is left unset
    and surfaces as "???" in the clients.
    """
    return MovieCreate(
        id=SNEAK_PREVIEW_MOVIE_ID,
        title=SNEAK_PREVIEW_TITLE,
        original_title=None,
        directors=None,
        cast=None,
        release_year=None,
        duration=None,
        languages=None,
        original_language=None,
        letterboxd_slug=None,
        poster_link=None,
        tmdb_last_enriched_at=None,
    )
