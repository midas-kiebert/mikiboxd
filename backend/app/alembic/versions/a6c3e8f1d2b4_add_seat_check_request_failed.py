"""Add seatcheckrequest.failed

A hand-requested seat read that failed at the ticket shop hides that
screening's check button for longer than the ordinary cooldown, so the button
is not offered where pressing it would most likely do nothing.

Forward DDL is idempotent so a replayed run can't wedge the backend.

Revision ID: a6c3e8f1d2b4
Revises: f2b7d4e9a1c3
Create Date: 2026-09-23 00:00:00.000000
"""

from alembic import op

revision = "a6c3e8f1d2b4"
down_revision = "f2b7d4e9a1c3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE seatcheckrequest "
        "ADD COLUMN IF NOT EXISTS failed BOOLEAN NOT NULL DEFAULT false"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE seatcheckrequest DROP COLUMN IF EXISTS failed")
