"""add scraperecap table

Stores each scrape run's rendered recap so the recap email can be sent once a
day (aggregating every run in the last 24h) instead of after every run. Forward
DDL is idempotent so a replayed run can't wedge the backend.

Revision ID: d6e7f8a9b0c1
Revises: c5d6e7f8a9b0
Create Date: 2026-07-24 13:10:00.000000
"""

from alembic import op

revision = "d6e7f8a9b0c1"
down_revision = "c5d6e7f8a9b0"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS scraperecap (
            id SERIAL PRIMARY KEY,
            started_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
            finished_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
            subject VARCHAR NOT NULL,
            html VARCHAR NOT NULL,
            attachments_json VARCHAR NOT NULL DEFAULT '[]',
            created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_scraperecap_started_at "
        "ON scraperecap (started_at)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_scraperecap_created_at "
        "ON scraperecap (created_at)"
    )


def downgrade():
    op.execute("DROP TABLE IF EXISTS scraperecap")
