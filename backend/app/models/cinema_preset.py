"""Cinema preset model — user-saved cinema selection configurations."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, UniqueConstraint
from sqlmodel import Column, Field, SQLModel

from app.utils import now_amsterdam_naive

# The "every cinema" preset every user is offered. It has no row: it is
# synthesised per request by `me.list_cinema_presets`, so anything that stores
# this id has to special-case it rather than look it up. Lives on the model
# rather than in the service so consumers (the watchlist digest) can recognise
# it without importing the whole `me` service.
DEFAULT_CINEMA_PRESET_ID = uuid.UUID("00000000-0000-0000-0000-000000000003")
DEFAULT_CINEMA_PRESET_NAME = "All cinemas"

# The name reserved for a preferred selection that has no name of its own:
# "Set as preferred cinemas" on an unnamed selection writes into the row with
# this name (see `me.set_favorite_cinema_ids`). Which row *is* preferred is
# still `is_favorite`, never this name — the user can rename it, or promote a
# preset they named, and every read of the preferred cinemas follows the flag.
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
    # The selection as it was ticked when the preset was saved. Kept as the
    # fallback for rows saved before scopes existed; everything else reads the
    # resolved selection, which comes from ``cinema_scope``.
    cinema_ids: list[int] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False),
    )
    # The rule behind that selection (``app.schemas.cinema_scope.CinemaScope``),
    # so cinemas that open after the preset was saved land inside it. ``None``
    # on rows that predate scopes.
    cinema_scope: dict[str, Any] | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    is_favorite: bool = Field(default=False, nullable=False, index=True)
    created_at: datetime = Field(default_factory=now_amsterdam_naive, nullable=False)
    updated_at: datetime = Field(default_factory=now_amsterdam_naive, nullable=False)
