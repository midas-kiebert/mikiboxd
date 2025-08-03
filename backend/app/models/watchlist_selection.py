from sqlmodel import Field, SQLModel

__all__ = [
    "WatchlistSelection",
]


class WatchlistSelection(SQLModel, table=True):
    letterboxd_username: str = Field(
        foreign_key="letterboxd.letterboxd_username", primary_key=True
    )
    movie_id: int = Field(foreign_key="movie.id", primary_key=True)
