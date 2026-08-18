"""Add `key` and `aliases` to `cinema`

A cinema's name used to be its identity: seeding upserted on it, scrapers looked
themselves up by it, and Cineville venues were matched against it. That made a
rename impossible to do safely — editing the name in cinemas.yaml would insert a
second cinema and leave every showtime on the old row.

`key` takes over as the identity and never changes, freeing `name` to be a purely
cosmetic field that can be edited at will. `aliases` holds the other names a
cinema is known by (Cineville's venue name, former display names) so a rename
breaks neither ingestion nor search.

Existing rows are backfilled with a key slugified from their current name, which
is exactly how the keys in cinemas.yaml were generated, so the next seed matches
them in place. `upsert_cinema` also falls back to a name match, so a row whose
slug does not line up is adopted rather than duplicated.

Revision ID: b7e4c1a9d6f2
Revises: c3f8b1d5e0a7
Create Date: 2026-08-03 15:00:00.000000
"""

from alembic import op

revision = "b7e4c1a9d6f2"
down_revision = "c3f8b1d5e0a7"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE cinema ADD COLUMN IF NOT EXISTS key VARCHAR")
    op.execute(
        "ALTER TABLE cinema "
        "ADD COLUMN IF NOT EXISTS aliases VARCHAR[] NOT NULL DEFAULT '{}'"
    )
    # Same slug rule as the script that generated the keys in cinemas.yaml:
    # unaccent, lowercase, every run of non-alphanumerics to a single dash.
    op.execute(
        """
        UPDATE cinema
        SET key = trim(
            both '-' from regexp_replace(lower(unaccent(name)), '[^a-z0-9]+', '-', 'g')
        )
        WHERE key IS NULL
        """
    )
    op.execute("ALTER TABLE cinema ALTER COLUMN key SET NOT NULL")
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS ix_cinema_key ON cinema (key)")


def downgrade():
    op.execute("DROP INDEX IF EXISTS ix_cinema_key")
    op.execute("ALTER TABLE cinema DROP COLUMN IF EXISTS aliases")
    op.execute("ALTER TABLE cinema DROP COLUMN IF EXISTS key")
