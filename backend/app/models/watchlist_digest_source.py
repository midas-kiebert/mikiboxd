"""A per-user watchlist digest source: one eager/weekly notification rule.

A user may have any number of these. Each pairs a movie source (their
Letterboxd watchlist, or a chosen list override) with an optional cinema
restriction (a saved cinema preset, or a one-off custom selection that is
never persisted as a preset) and its own send frequency —
`services/watchlist_digest.py` evaluates and mails each independently.

`list_id` and `cinema_preset_id` are plain uuids with no DB-level FK,
matching the columns they replace on `User` (see
`f1a2b3c4d5e6_add_watchlist_digest_cinema_preset.py`): a dangling reference
(the list or preset was deleted after being chosen) is tolerated by the
service rather than blocked at the database.
"""

import uuid
from datetime import datetime

from sqlalchemy import JSON
from sqlalchemy import Enum as SAEnum
from sqlmodel import Column, Field, SQLModel

from app.core.enums import DigestFrequency
from app.utils import now_amsterdam_naive


class WatchlistDigestSource(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    owner_user_id: uuid.UUID = Field(
        foreign_key="user.id", ondelete="CASCADE", index=True
    )
    frequency: DigestFrequency = Field(
        sa_column=Column(
            SAEnum(
                DigestFrequency,
                native_enum=False,
                length=40,
                values_callable=lambda enum: [m.value for m in enum],
            ),
            nullable=False,
        ),
        default=DigestFrequency.WEEKLY_OR_URGENT,
    )
    # None means "my Letterboxd watchlist".
    list_id: uuid.UUID | None = Field(default=None)
    # At most one of these two is ever set; neither set means "all cinemas".
    # Enforced by the service layer, not the database.
    cinema_preset_id: uuid.UUID | None = Field(default=None)
    custom_cinema_ids: list[int] | None = Field(
        default=None, sa_column=Column(JSON, nullable=True)
    )
    last_sent_at: datetime | None = Field(default=None)
    created_at: datetime = Field(default_factory=now_amsterdam_naive, nullable=False)
