"""User block — one user refusing all contact from another.

Directional and stored as a single row: `blocker_id` blocked `blocked_id`. Only
the blocker can lift it, and the blocked user is never told a block exists.

The block is deliberately *not* symmetric in storage but *is* symmetric in
effect: everywhere the app decides whether two users may see or reach each
other it asks `is_blocked_either_way`, so blocking someone also stops them
reaching you. Storing it one-directionally is what lets each side block
independently — B blocking A back, then unblocking, must not lift A's block on
B.
"""

from datetime import datetime
from uuid import UUID

from sqlmodel import Field, SQLModel

from app.utils import now_amsterdam_naive


class UserBlock(SQLModel, table=True):
    blocker_id: UUID = Field(
        foreign_key="user.id", ondelete="CASCADE", primary_key=True
    )
    blocked_id: UUID = Field(
        foreign_key="user.id", ondelete="CASCADE", primary_key=True
    )
    created_at: datetime = Field(default_factory=now_amsterdam_naive, nullable=False)
