"""Public schemas for the Letterboxd lists API."""

from datetime import datetime
from uuid import UUID

from sqlmodel import SQLModel

__all__ = ["LetterboxdListCreate", "LetterboxdListPublic"]


class LetterboxdListCreate(SQLModel):
    url: str


class LetterboxdListPublic(SQLModel):
    id: UUID
    owner: str
    list_slug: str
    title: str | None
    url: str
    is_curated: bool
    last_updated_on_letterboxd: datetime | None
    last_synced: datetime | None
    film_count: int
