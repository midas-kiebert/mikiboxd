"""add showtime created_at and watchlist digest settings

Adds:
  - `showtime.created_at`, used to tell genuinely new showtimes apart from
    ones that merely became future-dated again. Existing rows are backfilled
    to a date far in the past so nothing already in the table looks "new" on
    the first digest run.
  - Per-user watchlist digest settings: enabled flag, frequency, and an
    optional Letterboxd list override.

All forward DDL is idempotent so a partial/replayed run on staging cannot
wedge the backend.

Revision ID: e4f5a6b7c8d9
Revises: c7e9a1b3d5f2
Create Date: 2026-06-26 12:00:00.000000
"""

from alembic import op

revision = "e4f5a6b7c8d9"
down_revision = "c7e9a1b3d5f2"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "ALTER TABLE showtime "
        "ADD COLUMN IF NOT EXISTS created_at timestamp NOT NULL DEFAULT now()"
    )
    # Existing rows weren't actually created "now" — backfill them to a date
    # far in the past so they aren't mistaken for new showtimes.
    op.execute("UPDATE showtime SET created_at = '2000-01-01' WHERE created_at > '2000-01-01'")

    op.execute(
        'ALTER TABLE "user" '
        "ADD COLUMN IF NOT EXISTS notify_watchlist_digest_enabled boolean "
        "NOT NULL DEFAULT true"
    )
    op.execute(
        'ALTER TABLE "user" '
        "ADD COLUMN IF NOT EXISTS notify_watchlist_digest_frequency varchar "
        "NOT NULL DEFAULT 'weekly'"
    )
    op.execute(
        'ALTER TABLE "user" '
        "ADD COLUMN IF NOT EXISTS notify_watchlist_digest_list_id uuid"
    )
    op.execute(
        'ALTER TABLE "user" '
        "ADD COLUMN IF NOT EXISTS notify_watchlist_digest_last_sent_at timestamp"
    )


def downgrade():
    op.execute(
        'ALTER TABLE "user" DROP COLUMN IF EXISTS notify_watchlist_digest_last_sent_at'
    )
    op.execute(
        'ALTER TABLE "user" DROP COLUMN IF EXISTS notify_watchlist_digest_list_id'
    )
    op.execute(
        'ALTER TABLE "user" DROP COLUMN IF EXISTS notify_watchlist_digest_frequency'
    )
    op.execute(
        'ALTER TABLE "user" DROP COLUMN IF EXISTS notify_watchlist_digest_enabled'
    )
    op.execute("ALTER TABLE showtime DROP COLUMN IF EXISTS created_at")
