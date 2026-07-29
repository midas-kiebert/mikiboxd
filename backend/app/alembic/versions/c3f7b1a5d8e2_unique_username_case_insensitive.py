"""One account per username, case-insensitively

The services already reject a taken username on registration and on update, but
that check and the insert that follows it are two separate statements: two
requests that interleave between them both pass, and both write. Nothing below
the service layer enforced it at all, so any other writer (a script, a seed, a
future endpoint) could quietly create a second `Midas` next to `midas`.

A partial unique index on `lower(display_name)` makes it the database's rule
instead of a convention. Partial because `display_name` is legitimately NULL
between a social sign-in creating the account and the user picking a name — one
NULL per account, however many there are.

Case-insensitive because a username is an identity: `Midas` and `midas` are the
same person to everyone reading it, and letting both exist makes friend search
ambiguous in exactly the situation where being recognised is the whole point.

Forward DDL is idempotent so a partial/replayed run cannot wedge the backend.
It will, deliberately, fail on a database that already holds duplicates —
renaming someone's username to make an index build is not a migration's call.
Both prod and staging were checked clean before this was written.

Revision ID: c3f7b1a5d8e2
Revises: e7a1c4b9d2f5
Create Date: 2026-07-29 15:40:00.000000
"""

from alembic import op

revision = "c3f7b1a5d8e2"
down_revision = "e7a1c4b9d2f5"
branch_labels = None
depends_on = None


# Kept in step with `DISPLAY_NAME_UNIQUE_INDEX` in app/crud/user.py, which reads
# it back off the IntegrityError to tell a username clash from an email one.
# Spelled out here rather than imported: a migration has to keep working against
# the code as it was, not as it is.
INDEX_NAME = "uq_user_display_name_lower"


def upgrade() -> None:
    op.execute(
        f'CREATE UNIQUE INDEX IF NOT EXISTS {INDEX_NAME} '
        'ON "user" (lower(display_name)) '
        "WHERE display_name IS NOT NULL"
    )


def downgrade() -> None:
    op.execute(f"DROP INDEX IF EXISTS {INDEX_NAME}")
