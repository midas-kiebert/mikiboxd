from sqlmodel import SQLModel

from app.core.enums import VisibilityMode

__all__ = [
    "ShowtimeVisibilityPublic",
    "ShowtimeVisibilityUpdate",
]


class ShowtimeVisibilityUpdate(SQLModel):
    mode: VisibilityMode


class ShowtimeVisibilityPublic(SQLModel):
    showtime_id: int
    movie_id: int
    mode: VisibilityMode
