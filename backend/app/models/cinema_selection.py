"""Cinema selection — the set of cinemas a user has chosen to follow."""

from uuid import UUID

from sqlmodel import Field, SQLModel


class CinemaSelection(SQLModel, table=True):
    user_id: UUID = Field(foreign_key="user.id", ondelete="CASCADE", primary_key=True)
    cinema_id: int = Field(foreign_key="cinema.id", primary_key=True)
