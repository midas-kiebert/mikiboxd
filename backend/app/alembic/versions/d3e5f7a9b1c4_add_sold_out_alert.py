"""add the separate sold-out notice for interested showtimes

"Nearly sold out" and "sold out" are two different notices now — the first is
a once-ever nudge to go and buy a seat while one still exists, the second says
the seat is gone. They need independent state: a user's own on/off + channel
preference for each, and a separate "already told them" stamp per showtime
selection so the two do not compete for the same guard.

Forward DDL is idempotent so a replayed run can't wedge the backend.

Revision ID: d3e5f7a9b1c4
Revises: c8a4e1b60d3f
Create Date: 2026-08-31 00:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

revision = "d3e5f7a9b1c4"
down_revision = "c8a4e1b60d3f"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        sa.text(
            'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS notify_on_sold_out '
            "BOOLEAN NOT NULL DEFAULT TRUE"
        )
    )
    # 'PUSH', not 'push': the notify_channel_* columns store the
    # NotificationChannel enum's member *name*, not its value (no
    # `values_callable` on this field) — see c3f1a90d4e77 and bc34de56fa78,
    # which fixed this exact mistake for the earlier notify_channel_* columns.
    op.execute(
        sa.text(
            'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS notify_channel_sold_out '
            "VARCHAR(16) NOT NULL DEFAULT 'PUSH'"
        )
    )
    op.execute(
        sa.text(
            "ALTER TABLE showtimeselection "
            "ADD COLUMN IF NOT EXISTS sold_out_alert_sent_at TIMESTAMP"
        )
    )


def downgrade():
    op.execute(
        sa.text(
            "ALTER TABLE showtimeselection DROP COLUMN IF EXISTS sold_out_alert_sent_at"
        )
    )
    op.execute(
        sa.text('ALTER TABLE "user" DROP COLUMN IF EXISTS notify_channel_sold_out')
    )
    op.execute(sa.text('ALTER TABLE "user" DROP COLUMN IF EXISTS notify_on_sold_out'))
