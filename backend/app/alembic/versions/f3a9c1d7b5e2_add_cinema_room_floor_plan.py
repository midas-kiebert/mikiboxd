"""add cinemaroomfloorplan table

Stores each covered cinema room's seat geometry, ingested once by
scripts/ingest-seat-floor-plans.py. Forward DDL is idempotent so a replayed
run can't wedge the backend.

Revision ID: f3a9c1d7b5e2
Revises: e1a7c3f9b204
Create Date: 2026-08-25 00:00:00.000000
"""

from alembic import op

revision = "f3a9c1d7b5e2"
down_revision = "e1a7c3f9b204"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS cinemaroomfloorplan (
            cinema_id INTEGER NOT NULL REFERENCES cinema (id) ON DELETE CASCADE,
            room VARCHAR(255) NOT NULL,
            seats JSONB NOT NULL,
            fetched_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
            PRIMARY KEY (cinema_id, room)
        )
        """
    )


def downgrade():
    op.execute("DROP TABLE IF EXISTS cinemaroomfloorplan")
