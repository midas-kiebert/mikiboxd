"""add report-admin and moderation fields

Adds the columns needed for the reports-admin overhaul: an exact scrape
source per showtime, a TMDB lookup-cache back-reference per movie (so a
cache correction can find and fix every movie it produced), and a
report-ban on users (temporary or indefinite).

Forward DDL is idempotent so a partial/replayed run on staging cannot wedge
the backend.

Revision ID: a2b3c4d5e6f7
Revises: e7f8a9b0c1d2
Create Date: 2026-07-24 16:00:00.000000
"""

from alembic import op

revision = "a2b3c4d5e6f7"
down_revision = "e7f8a9b0c1d2"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE showtime ADD COLUMN IF NOT EXISTS scrape_source VARCHAR")
    op.execute(
        "ALTER TABLE movie ADD COLUMN IF NOT EXISTS tmdb_cache_id INTEGER "
        "REFERENCES tmdblookupcache(id)"
    )
    op.execute(
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS report_banned BOOLEAN NOT NULL DEFAULT false'
    )
    op.execute(
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS report_ban_expires_at TIMESTAMP'
    )


def downgrade():
    op.execute('ALTER TABLE "user" DROP COLUMN IF EXISTS report_ban_expires_at')
    op.execute('ALTER TABLE "user" DROP COLUMN IF EXISTS report_banned')
    op.execute("ALTER TABLE movie DROP COLUMN IF EXISTS tmdb_cache_id")
    op.execute("ALTER TABLE showtime DROP COLUMN IF EXISTS scrape_source")
