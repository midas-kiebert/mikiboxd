"""Add user.watchlist_digest_ever_enabled

The watchlist digest is a feature nobody finds unless they go looking through
Settings, so a tip will eventually point it out. "Eventually" and "point it out
once" are the constraints: a user who turned the digest on and off again has
made a decision, and must not be told about it as though they had never heard
of it. `notify_watchlist_digest_enabled` only says what is true right now, so
this records that it was ever true.

Backfilled from the current flag: anyone with the digest on has plainly found
it. Anyone who had it on and turned it off before this existed reads as "never"
and may get told once — the alternative is inventing history we do not have,
and the tip is behind a switch that is off for now anyway.

Forward DDL is idempotent so a partial/replayed run cannot wedge the backend.

Revision ID: f6b2d0a4c8e7
Revises: e1c9d3a7f2b4
Create Date: 2026-07-29 18:40:00.000000
"""

from alembic import op

revision = "f6b2d0a4c8e7"
down_revision = "e1c9d3a7f2b4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS '
        "watchlist_digest_ever_enabled BOOLEAN NOT NULL DEFAULT false"
    )
    op.execute(
        'UPDATE "user" SET watchlist_digest_ever_enabled = true '
        "WHERE notify_watchlist_digest_enabled = true"
    )


def downgrade() -> None:
    op.execute(
        'ALTER TABLE "user" DROP COLUMN IF EXISTS watchlist_digest_ever_enabled'
    )
