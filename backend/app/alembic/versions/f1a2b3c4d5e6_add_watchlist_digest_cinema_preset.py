"""add notify_watchlist_digest_cinema_preset_id to user

Lets a user restrict their watchlist digest to a saved cinema preset. The
column is a plain uuid (no DB-level FK, matching ``notify_watchlist_digest_list_id``);
a dangling reference is tolerated by the service, which falls back to the
favorite preset. Forward DDL is idempotent so a replayed run can't wedge the
backend.

Revision ID: f1a2b3c4d5e6
Revises: b1c2d3e4f5a6
Create Date: 2026-06-29 12:00:00.000000
"""

from alembic import op

revision = "f1a2b3c4d5e6"
down_revision = "b1c2d3e4f5a6"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        'ALTER TABLE "user" '
        "ADD COLUMN IF NOT EXISTS notify_watchlist_digest_cinema_preset_id uuid"
    )


def downgrade():
    op.execute(
        'ALTER TABLE "user" '
        "DROP COLUMN IF EXISTS notify_watchlist_digest_cinema_preset_id"
    )
