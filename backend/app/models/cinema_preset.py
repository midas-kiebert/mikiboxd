import uuid
from datetime import datetime

from sqlalchemy import JSON, UniqueConstraint
from sqlmodel import Column, Field, SQLModel

from app.utils import now_amsterdam_naive

__all__ = [
    "CinemaPreset",
]


class CinemaPreset(SQLModel, table=True):
    __table_args__ = (
        UniqueConstraint(
            "owner_user_id",
            "name",
            name="uq_cinema_preset_owner_name",
        ),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    owner_user_id: uuid.UUID = Field(
        foreign_key="user.id",
        ondelete="CASCADE",
        index=True,
    )
    name: str = Field(max_length=80)
    cinema_ids: list[int] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False),
    )
    is_favorite: bool = Field(default=False, nullable=False, index=True)
    created_at: datetime = Field(default_factory=now_amsterdam_naive, nullable=False)
    updated_at: datetime = Field(default_factory=now_amsterdam_naive, nullable=False)
