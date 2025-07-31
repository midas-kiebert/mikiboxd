from uuid import UUID

from sqlmodel import Field, SQLModel

__all__ = [
    "WatchlistSelection",
]


class WatchlistSelection(SQLModel, table=True):
    user_id: UUID = Field(foreign_key="user.id", primary_key=True)
    movie_id: int = Field(foreign_key="movie.id", primary_key=True)
