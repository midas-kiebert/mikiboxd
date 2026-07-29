"""add user_login_email table

Every value someone can log in with — the current primary email, plus any
email a linked Google/Apple account reports — has to be reserved so no two
accounts can ever share one, including across sources (one user's primary
colliding with a different user's linked Google email). Per-column unique
constraints can't guarantee that on their own without race-prone
application-level cross-checks; one table with a single unique index across
every row does, atomically, at the database level.

One row per *reserved address*, not per role: a user keeps a reservation
permanently, even after it stops being their current primary (that is the
whole point — it is what lets someone still log in with the Google email
they signed up with after changing their primary away from it). `source` is
purely informational (which mechanism first reserved the row); it plays no
part in uniqueness, so the same user can hold several rows and reserving an
address they already hold is simply a no-op. `User.email` stays the source of
truth for "current primary" everywhere else in the app (mail, digest gating,
display) and is kept in sync with this table by the application, not a DB
trigger.

Forward DDL is idempotent so a partial/replayed run cannot wedge the backend.

Revision ID: c2d4e6f8a0b1
Revises: f6b2d0a4c8e7
Create Date: 2026-07-29 19:00:00.000000
"""

from alembic import op

revision = "c2d4e6f8a0b1"
down_revision = "f6b2d0a4c8e7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "CREATE TABLE IF NOT EXISTS user_login_email ("
        "id UUID NOT NULL PRIMARY KEY, "
        'user_id UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, '
        "source VARCHAR(40) NOT NULL, "
        "email VARCHAR(255) NOT NULL, "
        "created_at TIMESTAMP NOT NULL"
        ")"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_user_login_email_user_id "
        "ON user_login_email (user_id)"
    )
    # The actual reservation guarantee: no two rows, for the same or different
    # users, may ever share a lowercased email.
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_user_login_email_lower "
        "ON user_login_email (lower(email))"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_user_login_email_lower")
    op.execute("DROP INDEX IF EXISTS ix_user_login_email_user_id")
    op.execute("DROP TABLE IF EXISTS user_login_email")
