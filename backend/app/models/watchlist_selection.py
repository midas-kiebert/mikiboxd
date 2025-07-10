from sqlmodel import SQLModel, Field
from uuid import UUID

class WatchlistSelection(SQLModel, table=True):
    user_id: UUID = Field(foreign_key="user.id", primary_key=True)
    movie_id: int = Field(foreign_key="movie.id", primary_key=True)
