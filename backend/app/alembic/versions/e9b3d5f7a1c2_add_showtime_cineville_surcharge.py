"""Cineville surcharge per showtime

`showtime.cineville_surcharge_cents`: what a Cineville pass holder pays on top
of the pass, as read off the ticket shop by the seat availability poller (Eye
charges e.g. €5 for a live-music screening). NULL means "not read"; 0 means
the shop lists Cineville at no extra cost.

Revision ID: e9b3d5f7a1c2
Revises: d2a7f5c3e8b1
Create Date: 2026-09-25 00:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

revision = "e9b3d5f7a1c2"
down_revision = "d2a7f5c3e8b1"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        sa.text(
            "ALTER TABLE showtime ADD COLUMN IF NOT EXISTS "
            "cineville_surcharge_cents INTEGER"
        )
    )


def downgrade():
    op.execute(
        sa.text("ALTER TABLE showtime DROP COLUMN IF EXISTS cineville_surcharge_cents")
    )
