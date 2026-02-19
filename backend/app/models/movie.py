from datetime import datetime

from sqlalchemy import String
from sqlalchemy.dialects.postgresql import ARRAY
from sqlmodel import Column, Field, SQLModel

__all__ = [
    "MovieBase",
    "MovieCreate",
    "MovieUpdate",
    "Movie",
]


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
    release_year: int | None = None


# Properties to receive on movie creation
class MovieCreate(MovieBase):
    tmdb_last_enriched_at: datetime | None = None


# Properties to receive on movie update
class MovieUpdate(SQLModel):
    title: str | None = None
    poster_link: str | None = None
    letterboxd_slug: str | None = None
    tmdb_last_enriched_at: datetime | None = None


# Database model, database table inferred from class name
class Movie(MovieBase, table=True):
    tmdb_last_enriched_at: datetime | None = None
