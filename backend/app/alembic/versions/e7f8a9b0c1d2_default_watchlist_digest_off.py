"""default watchlist digest to off

Flips notify_watchlist_digest_enabled to default false and turns it off for
all existing users, so the digest stays opt-in while it's still being tested
rather than going out to everyone automatically.

Forward DDL is idempotent so a partial/replayed run on staging cannot wedge
the backend.

Revision ID: e7f8a9b0c1d2
Revises: d6e7f8a9b0c1
Create Date: 2026-07-24 15:00:00.000000
"""

from alembic import op

revision = "e7f8a9b0c1d2"
down_revision = "d6e7f8a9b0c1"
branch_labels = None
depends_on = None


def upgrade():
    op.execute('ALTER TABLE "user" ALTER COLUMN notify_watchlist_digest_enabled SET DEFAULT false')
    op.execute('UPDATE "user" SET notify_watchlist_digest_enabled = false')


def downgrade():
    op.execute('ALTER TABLE "user" ALTER COLUMN notify_watchlist_digest_enabled SET DEFAULT true')
