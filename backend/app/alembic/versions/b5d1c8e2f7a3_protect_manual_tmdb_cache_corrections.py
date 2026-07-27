"""Protect manual TMDB lookup-cache corrections from automated overwrites

Adds two columns to `tmdblookupcache`:

  * `is_manual_override` — set when an admin corrects a row by hand. Automated
    scraper lookups skip writes to a row carrying this flag.
  * `title_query` — the normalized title denormalized out of `lookup_payload`,
    indexed. The cache key hashes the whole payload (cast, runtime, spoken
    languages included), all of which come from the cinema's listing and drift
    without the film changing; when they do, the corrected row is missed and a
    fresh lookup silently re-derives the wrong id. This column is what lets a
    correction still be found across that drift.

Backfilled from the existing payload JSON. Forward DDL is idempotent so a
partial/replayed run cannot wedge the backend.

Revision ID: b5d1c8e2f7a3
Revises: a4c8e1f6b3d7
Create Date: 2026-07-27 12:00:00.000000
"""

from alembic import op

revision = "b5d1c8e2f7a3"
down_revision = "a4c8e1f6b3d7"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "ALTER TABLE tmdblookupcache "
        "ADD COLUMN IF NOT EXISTS is_manual_override BOOLEAN NOT NULL DEFAULT false"
    )
    op.execute("ALTER TABLE tmdblookupcache ADD COLUMN IF NOT EXISTS title_query VARCHAR")
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_tmdblookupcache_title_query "
        "ON tmdblookupcache (title_query)"
    )
    # Every payload was written by json.dumps, so the cast is safe; the LIKE is
    # cheap insurance against a hand-edited row taking the whole migration down.
    op.execute(
        "UPDATE tmdblookupcache "
        "SET title_query = (lookup_payload::json ->> 'title_query') "
        "WHERE title_query IS NULL AND lookup_payload LIKE '{%'"
    )


def downgrade():
    op.execute("DROP INDEX IF EXISTS ix_tmdblookupcache_title_query")
    op.execute("ALTER TABLE tmdblookupcache DROP COLUMN IF EXISTS title_query")
    op.execute("ALTER TABLE tmdblookupcache DROP COLUMN IF EXISTS is_manual_override")
