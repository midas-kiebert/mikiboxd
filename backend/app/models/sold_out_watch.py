"""A standing request to be told when a full showtime has seats again."""

from datetime import datetime
from uuid import UUID

from sqlmodel import Field, SQLModel

from app.utils import now_amsterdam_naive


class SoldOutWatch(SQLModel, table=True):
    """One user waiting on one showtime's returned tickets.

    Unlike everything else that reads a ticket shop, this exists to poll a
    single page hard — a returned ticket is gone in minutes, so a cadence that
    would be polite for the whole catalogue would simply never catch one. What
    keeps that affordable is that there is at most one of these per user (the
    unique `user_id`, not a compound key with the showtime), only some users may
    create one at all, and a global cap limits how many can run at once.

    A watch is one-shot: it stops itself the moment it finds a seat, and is
    deleted rather than kept around, so "does this user have a watch" is a row
    existing and nothing subtler.
    """

    id: int | None = Field(default=None, primary_key=True)
    user_id: UUID = Field(
        foreign_key="user.id", ondelete="CASCADE", unique=True, index=True
    )
    showtime_id: int = Field(foreign_key="showtime.id", ondelete="CASCADE", index=True)
    created_at: datetime = Field(default_factory=now_amsterdam_naive, nullable=False)
    # Written by the watch job the same way the poller writes its own due time.
    next_check_at: datetime = Field(default_factory=now_amsterdam_naive, index=True)
    last_checked_at: datetime | None = Field(default=None)
    # Drives the back-off: a watch that has looked many times without finding
    # anything looks less often, until the screening gets close.
    checks_done: int = Field(default=0)
