"""Add showtimeping.receiver_had_selection_at_creation

Invites can now be sent to a friend who already has a GOING/INTERESTED
selection on the showtime. That ping never represents an "acceptance" —
the receiver had already decided on their own — so it must not grant
either side visibility into the other's invite graph. This column records,
immutably at creation time, whether that was the case for each ping.

Historical rows default to false (the old code path blocked pinging anyone
whose status was already visible, and otherwise behaved as an ordinary
invite), which preserves current visibility for all existing data.

Forward DDL is idempotent so a partial/replayed run cannot wedge the backend.

Revision ID: b4d6e8f0a2c4
Revises: c4d5e6f70819
Create Date: 2026-08-18 00:00:00.000000
"""

from alembic import op

revision = "b4d6e8f0a2c4"
down_revision = "c4d5e6f70819"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE showtimeping ADD COLUMN IF NOT EXISTS "
        "receiver_had_selection_at_creation BOOLEAN NOT NULL DEFAULT false"
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE showtimeping DROP COLUMN IF EXISTS "
        "receiver_had_selection_at_creation"
    )
