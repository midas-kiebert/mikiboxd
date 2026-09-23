"""Add seat_check_request

One row per hand-requested seat reading. Shared by every uvicorn worker, so
the hourly budget on those reads (global and per ticket shop) and the
per-screening cooldown hold across the whole backend rather than per process.

Forward DDL is idempotent so a partial/replayed run cannot wedge the backend.

Revision ID: e8c4a1f6b2d9
Revises: d5f9b3a7c2e1
Create Date: 2026-09-23 00:00:00.000000
"""

from alembic import op

revision = "e8c4a1f6b2d9"
down_revision = "d5f9b3a7c2e1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS seatcheckrequest (
            id SERIAL PRIMARY KEY,
            showtime_id INTEGER NOT NULL
                REFERENCES showtime (id) ON DELETE CASCADE,
            host VARCHAR NOT NULL,
            requested_at TIMESTAMP WITHOUT TIME ZONE NOT NULL
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_seatcheckrequest_showtime_id "
        "ON seatcheckrequest (showtime_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_seatcheckrequest_host "
        "ON seatcheckrequest (host)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_seatcheckrequest_requested_at "
        "ON seatcheckrequest (requested_at)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS seatcheckrequest")
