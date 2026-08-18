"""Cinema preset model — user-saved cinema selection configurations."""

import uuid
from datetime import datetime

from sqlalchemy import JSON, UniqueConstraint
from sqlmodel import Column, Field, SQLModel

from app.utils import now_amsterdam_naive

# The "every cinema" preset every user is offered. It has no row: it is
# synthesised per request by `me.list_cinema_presets`, so anything that stores
# this id has to special-case it rather than look it up. Lives on the model
# rather than in the service so consumers (the watchlist digest) can recognise
# it without importing the whole `me` service.
DEFAULT_CINEMA_PRESET_ID = uuid.UUID("00000000-0000-0000-0000-000000000003")
DEFAULT_CINEMA_PRESET_NAME = "All Cinemas"

# The name of the one preset every user has whether they asked for it or not:
# the cinemas they actually go to, applied on startup. It is a real row, marked
# by `is_favorite` rather than by this name — the name is only what the manage
# screen shows, and the user is free to change it. Nothing may key off it.
FAVORITE_CINEMA_PRESET_NAME = "My Cinemas"


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
