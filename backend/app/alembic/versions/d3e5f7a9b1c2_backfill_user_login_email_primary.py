"""backfill user_login_email primary rows

Reserves every existing user's current email as their PRIMARY row.

Pre-existing Google/Apple links (`user.google_sub`/`apple_sub`) have no
recorded historical email for that provider identity — only the opaque
subject ID was ever stored — so a GOOGLE/APPLE row for those accounts cannot
be backfilled here. It is populated lazily the next time that user completes
a social sign-in (see `get_or_create_social_user`), not by this migration.

Backfilled with a bare `INSERT ... ON CONFLICT DO NOTHING` targeting the
table's own unique index on `lower(email)`, deliberately unqualified like the
`email_verified` backfill (e1c9d3a7f2b4) — it runs once, before any account
could already have a row here, so "every user" and "every row to backfill"
are the same set. `DO NOTHING` is a safety net rather than an expected path:
`user.email` already carries its own case-insensitive unique index
(uq_user_email_lower), so no two source rows should collide here either.

Revision ID: d3e5f7a9b1c2
Revises: c2d4e6f8a0b1
Create Date: 2026-07-29 19:05:00.000000
"""

from alembic import op

revision = "d3e5f7a9b1c2"
down_revision = "c2d4e6f8a0b1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "INSERT INTO user_login_email (id, user_id, source, email, created_at) "
        "SELECT uuid_generate_v4(), id, 'primary', email, now() "
        'FROM "user" '
        "ON CONFLICT (lower(email)) DO NOTHING"
    )


def downgrade() -> None:
    op.execute("DELETE FROM user_login_email WHERE source = 'primary'")
