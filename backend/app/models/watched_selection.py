"""Watched selection — movies a Letterboxd user has marked as watched."""

from sqlmodel import Field, SQLModel


class WatchedSelection(SQLModel, table=True):
    letterboxd_username: str = Field(
        foreign_key="letterboxd.letterboxd_username", primary_key=True
    )
    letterboxd_slug: str = Field(primary_key=True)
    movie_id: int | None = Field(default=None, foreign_key="movie.id")
