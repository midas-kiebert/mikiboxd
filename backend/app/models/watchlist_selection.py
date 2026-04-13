"""Watchlist selection — movies on a Letterboxd user's watchlist that are currently showing."""

from sqlmodel import Field, SQLModel


class WatchlistSelection(SQLModel, table=True):
    letterboxd_username: str = Field(
        foreign_key="letterboxd.letterboxd_username", primary_key=True
    )
    movie_id: int = Field(foreign_key="movie.id", primary_key=True)
