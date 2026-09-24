"""Add the "tickets available again" seat notice

Sold-out screenings used to be parked at their own start time and never read
again. The poller now keeps a thin watch on them, and interested users are told
when one has seats again: a per-user on/off + channel preference, and a
per-selection "already told them" stamp.

Also un-parks every upcoming sold-out screening, so the watch covers the ones
that sold out before it existed. They are made due one hour after their last
reading — already past for nearly all of them, so the poller drains them at its
usual capped rate, with the one-hour gap as the priority interval it reads.

Forward DDL is idempotent so a replayed run can't wedge the backend.

Revision ID: f2b7d4e9a1c3
Revises: e8c4a1f6b2d9
Create Date: 2026-09-23 00:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

revision = "f2b7d4e9a1c3"
down_revision = "e8c4a1f6b2d9"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        sa.text(
            'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS notify_on_tickets_available '
            "BOOLEAN NOT NULL DEFAULT TRUE"
        )
    )
    # 'PUSH', not 'push': the notify_channel_* columns store the enum member's
    # name — see d3e5f7a9b1c4.
    op.execute(
        sa.text(
            'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS '
            "notify_channel_tickets_available VARCHAR(16) NOT NULL DEFAULT 'PUSH'"
        )
    )
    op.execute(
        sa.text(
            "ALTER TABLE showtimeselection "
            "ADD COLUMN IF NOT EXISTS tickets_available_alert_sent_at TIMESTAMP"
        )
    )
    # Parked means due exactly at the start time; only those are touched, so a
    # replay after the poller has rescheduled them changes nothing.
    op.execute(
        sa.text(
            "UPDATE showtime "
            "SET seats_next_check_at = seats_checked_at + INTERVAL '1 hour' "
            "WHERE seats_left <= 0 "
            "AND seats_checked_at IS NOT NULL "
            "AND seats_next_check_at = datetime "
            "AND datetime > (now() AT TIME ZONE 'Europe/Amsterdam')"
        )
    )


def downgrade():
    op.execute(
        sa.text(
            "ALTER TABLE showtimeselection "
            "DROP COLUMN IF EXISTS tickets_available_alert_sent_at"
        )
    )
    op.execute(
        sa.text(
            'ALTER TABLE "user" DROP COLUMN IF EXISTS notify_channel_tickets_available'
        )
    )
    op.execute(
        sa.text('ALTER TABLE "user" DROP COLUMN IF EXISTS notify_on_tickets_available')
    )
