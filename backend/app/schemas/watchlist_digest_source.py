"""Wire schemas for watchlist digest sources."""

import uuid
from datetime import datetime

from pydantic import model_validator
from sqlmodel import SQLModel

from app.core.enums import DigestFrequency


class WatchlistDigestSourceCreate(SQLModel):
    frequency: DigestFrequency = DigestFrequency.WEEKLY_OR_URGENT
    # None means "my Letterboxd watchlist".
    list_id: uuid.UUID | None = None
    # At most one of these two may be set; neither means "all cinemas".
    cinema_preset_id: uuid.UUID | None = None
    custom_cinema_ids: list[int] | None = None

    @model_validator(mode="after")
    def _cinema_selection_is_exclusive(self) -> "WatchlistDigestSourceCreate":
        if self.cinema_preset_id is not None and self.custom_cinema_ids is not None:
            raise ValueError(
                "cinema_preset_id and custom_cinema_ids are mutually exclusive"
            )
        return self


class WatchlistDigestSourceUpdate(SQLModel):
    """Every field is a partial update (PATCH semantics, `exclude_unset`).

    Switching the cinema selection from a preset to a custom list (or back)
    is done by sending both fields explicitly in the same request — e.g.
    `{"cinema_preset_id": "<id>", "custom_cinema_ids": null}` — the service
    also clears the other field itself if only one is sent, so a client never
    has to.
    """

    frequency: DigestFrequency | None = None
    list_id: uuid.UUID | None = None
    cinema_preset_id: uuid.UUID | None = None
    custom_cinema_ids: list[int] | None = None


class WatchlistDigestSourcePublic(SQLModel):
    id: uuid.UUID
    frequency: DigestFrequency
    list_id: uuid.UUID | None
    cinema_preset_id: uuid.UUID | None
    custom_cinema_ids: list[int] | None
    created_at: datetime
