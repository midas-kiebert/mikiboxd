"""Push token model — Expo push tokens registered per user device."""

from uuid import UUID

from sqlmodel import Field, SQLModel


class PushToken(SQLModel, table=True):
    token: str = Field(primary_key=True, max_length=255)
    user_id: UUID = Field(foreign_key="user.id", ondelete="CASCADE", index=True)
    platform: str | None = Field(default=None, max_length=32)
