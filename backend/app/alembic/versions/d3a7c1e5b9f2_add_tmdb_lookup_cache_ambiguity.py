"""Add tmdblookupcache.ambiguity_json and ambiguity_reviewed_at

A lookup where several films match a listing equally well (LAB111's
"Fahrenheit 9/11" tied with *Fahrenheit 11/9*) is a limit of the matcher that
the admin dashboard should surface, whether or not a tie-break then picked one.
The tie is only known at the moment of the network lookup — afterwards only the
cached answer is read — so it is stored on the cache row it produced, with a
reviewed timestamp so the dashboard can list what still needs a look.

Forward DDL is idempotent so a partial/replayed run cannot wedge the backend.

Revision ID: d3a7c1e5b9f2
Revises: a5c1e9d3f7b2
Create Date: 2026-09-16 00:00:00.000000
"""

from alembic import op

revision = "d3a7c1e5b9f2"
down_revision = "a5c1e9d3f7b2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE tmdblookupcache ADD COLUMN IF NOT EXISTS ambiguity_json VARCHAR"
    )
    op.execute(
        "ALTER TABLE tmdblookupcache ADD COLUMN IF NOT EXISTS "
        "ambiguity_reviewed_at TIMESTAMP WITHOUT TIME ZONE"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE tmdblookupcache DROP COLUMN IF EXISTS ambiguity_reviewed_at")
    op.execute("ALTER TABLE tmdblookupcache DROP COLUMN IF EXISTS ambiguity_json")
