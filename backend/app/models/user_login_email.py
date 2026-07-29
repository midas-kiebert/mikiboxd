"""Every email a user can ever log in with — primary, plus any Google/Apple
email that has been linked to their account.

One row per *reserved address*, not per role: once an address is reserved to
a user it stays reserved to them permanently, even if it stops being their
current primary (e.g. they sign up via Google, then change their primary
email — the original Google address keeps its row and stays loginable).
Because of that, the same user can legitimately hold several rows, and at
signup their primary and Google/Apple email are typically the *same* string
reserved for the *same* reason — so reservation is idempotent per user
(reserving an address a user already holds is a no-op) rather than "replace
whatever this source held".

The single global unique index on `lower(email)` (migration-created, see
`uq_user_login_email_lower`) is what guarantees no two different users can
ever hold the same address — per-column unique constraints alone couldn't
prevent a collision between, say, one user's primary email and a different
user's linked Google email. `source` is purely informational (which
mechanism first reserved this row); it plays no role in uniqueness or lookup.

`User.email` remains the source of truth for the current primary address
(mail, digest gating, display) — this table only answers "who may log in
with this address."
"""

import uuid
from datetime import datetime

from sqlalchemy import Enum as SAEnum
from sqlmodel import Column, Field, SQLModel

from app.core.enums import LoginEmailSource
from app.utils import now_amsterdam_naive


class UserLoginEmail(SQLModel, table=True):
    __tablename__ = "user_login_email"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: uuid.UUID = Field(foreign_key="user.id", ondelete="CASCADE", index=True)
    source: LoginEmailSource = Field(
        sa_column=Column(
            SAEnum(
                LoginEmailSource,
                native_enum=False,
                length=40,
                values_callable=lambda enum: [m.value for m in enum],
            ),
            nullable=False,
        ),
    )
    email: str = Field(max_length=255)
    created_at: datetime = Field(default_factory=now_amsterdam_naive)
