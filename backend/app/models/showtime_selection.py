from uuid import UUID

from sqlmodel import Field, SQLModel


class ShowtimeSelection(SQLModel, table=True):
    user_id: UUID = Field(foreign_key="user.id", primary_key=True)
    showtime_id: int = Field(foreign_key="showtime.id", primary_key=True)
