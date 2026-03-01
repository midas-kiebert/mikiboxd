from uuid import UUID

from sqlmodel import Field, SQLModel

__all__ = [
    "PushToken",
]


class PushToken(SQLModel, table=True):
    token: str = Field(primary_key=True, max_length=255)
    user_id: UUID = Field(foreign_key="user.id", ondelete="CASCADE", index=True)
    platform: str | None = Field(default=None, max_length=32)
