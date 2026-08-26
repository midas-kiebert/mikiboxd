"""add showtimeseatmap table

Stores the per-seat half of a seat availability reading — which individual
seats were taken — so the seat picker is drawn from the database instead of
re-reading the cinema's booking system on every sheet open. Written by the
same poller pass that writes the counts, from the same response.

Kept off `showtime` on purpose: every catalogue query selects that row in
full, and only one endpoint ever wants this.

Forward DDL is idempotent so a replayed run can't wedge the backend.

Revision ID: d4e7b2a9c6f1
Revises: a4c8e1f6d203
Create Date: 2026-08-26 00:00:00.000000
"""

from alembic import op

revision = "d4e7b2a9c6f1"
down_revision = "a4c8e1f6d203"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS showtimeseatmap (
            showtime_id INTEGER NOT NULL REFERENCES showtime (id) ON DELETE CASCADE,
            taken JSONB NOT NULL,
            checked_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
            PRIMARY KEY (showtime_id)
        )
        """
    )


def downgrade():
    op.execute("DROP TABLE IF EXISTS showtimeseatmap")
