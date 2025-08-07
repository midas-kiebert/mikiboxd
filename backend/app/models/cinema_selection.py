from uuid import UUID

from sqlmodel import Field, SQLModel

__all__ = [
    "CinemaSelection",
]


class CinemaSelection(SQLModel, table=True):
    user_id: UUID = Field(foreign_key="user.id", primary_key=True)
    cinema_id: int = Field(foreign_key="cinema.id", primary_key=True)
