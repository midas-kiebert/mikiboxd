"""Add `metrics_json` to `scraperecap`

The daily recap email used to be the per-run HTML blobs concatenated, which made
reading one statistic across a day's runs a scroll through several near-identical
reports. Each run now also stores its figures as JSON so the daily job can render
the email grouped by statistic — combined value first, then each run's.

Existing rows default to '{}' and fall back to their stored `html`, so a deploy
part-way through a recap window does not drop that window's earlier runs.

Revision ID: c3f8b1d5e0a7
Revises: e2f4a6c8b0d2
Create Date: 2026-08-03 12:00:00.000000
"""

from alembic import op

revision = "c3f8b1d5e0a7"
down_revision = "e2f4a6c8b0d2"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "ALTER TABLE scraperecap "
        "ADD COLUMN IF NOT EXISTS metrics_json VARCHAR NOT NULL DEFAULT '{}'"
    )


def downgrade():
    op.execute("ALTER TABLE scraperecap DROP COLUMN IF EXISTS metrics_json")
