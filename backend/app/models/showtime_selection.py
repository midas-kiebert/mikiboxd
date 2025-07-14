from sqlmodel import SQLModel, Field
from uuid import UUID


class ShowtimeSelection(SQLModel, table=True):
    user_id: UUID = Field(foreign_key="user.id", primary_key=True)
    showtime_id: int = Field(foreign_key="showtime.id", primary_key=True)
