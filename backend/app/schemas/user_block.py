from datetime import datetime
from uuid import UUID

from sqlmodel import SQLModel

__all__ = [
    "BlockedUserPublic",
]


class BlockedUserPublic(SQLModel):
    """One row of the "Blocked accounts" list.

    Carries the display name rather than only the id so the list is readable
    without a second request per row — the blocked user is deliberately not
    reachable through search any more, so the client cannot look them up.
    """

    id: UUID
    display_name: str | None
    blocked_at: datetime
