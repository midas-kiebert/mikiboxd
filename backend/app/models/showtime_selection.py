from uuid import UUID

from sqlalchemy import Enum as SAEnum
from sqlmodel import Column, Field, SQLModel

from app.core.enums import GoingStatus

__all__ = [
    "ShowtimeSelection",
]


class ShowtimeSelection(SQLModel, table=True):
    user_id: UUID = Field(foreign_key="user.id", primary_key=True)
    showtime_id: int = Field(foreign_key="showtime.id", primary_key=True)
    going_status: GoingStatus = Field(
        default=GoingStatus.GOING,
        sa_column=Column(SAEnum(GoingStatus, native_enum=False), nullable=False)
    )
