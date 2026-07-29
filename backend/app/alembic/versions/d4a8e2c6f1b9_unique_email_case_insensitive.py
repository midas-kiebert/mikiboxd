"""One account per email address, case-insensitively

`user.email` is unique, but only exactly: `Bob@example.com` and
`bob@example.com` are two rows to Postgres and one mailbox to everyone else.
That let the same person hold two accounts without ever being told, and made
"Continue with Google" for an address a password account had already registered
in a different capitalisation create a second, empty account instead of signing
them into their own — the providers hand back a lowercased address, so the
lookup that should have linked them missed.

`get_user_by_email` now matches case-insensitively, which fixes the lookup;
this index is what stops the two rows existing in the first place, including
when two registrations race each other.

Forward DDL is idempotent so a partial/replayed run cannot wedge the backend.
It will, deliberately, fail on a database that already holds two accounts for
one mailbox — merging accounts is not a migration's call. Prod and staging were
checked clean before this was written (two addresses carry capitals; neither has
a lowercase twin).

Revision ID: d4a8e2c6f1b9
Revises: c3f7b1a5d8e2
Create Date: 2026-07-29 16:20:00.000000
"""

from alembic import op

revision = "d4a8e2c6f1b9"
down_revision = "c3f7b1a5d8e2"
branch_labels = None
depends_on = None


INDEX_NAME = "uq_user_email_lower"


def upgrade() -> None:
    op.execute(
        f"CREATE UNIQUE INDEX IF NOT EXISTS {INDEX_NAME} "
        'ON "user" (lower(email))'
    )


def downgrade() -> None:
    op.execute(f"DROP INDEX IF EXISTS {INDEX_NAME}")
