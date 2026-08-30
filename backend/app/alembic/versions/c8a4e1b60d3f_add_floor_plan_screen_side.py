"""add screen_side to cinemaroomfloorplan

The seat picker drew the screen above the grid, hardcoded, on the strength of
row 1 being the row nearest the screen in all 36 rooms ingested so far. That
holds for the Eagerly platform and nothing else: Filmhuis Alkmaar numbers its
rows from the back, so its row 1 sits at the bottom of a plan whose screen is
at the top, and Cinecenter draws its screen below the seats outright.

Which end the screen is at is therefore a fact about the room, not something
to be worked out from the seats. Only Tricket states it (its seat map draws
the screen line as part of the layout); every other platform hands back seats
and nothing else, so this defaults to `top` — what every stored room already
renders as — and is corrected per room from
`app/configs/seat_screen_side_overrides.yaml` on the next ingest.

Forward DDL is idempotent so a replayed run can't wedge the backend.

Revision ID: c8a4e1b60d3f
Revises: b7c4e2f81a05
Create Date: 2026-08-30 00:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

revision = "c8a4e1b60d3f"
down_revision = "b7c4e2f81a05"
branch_labels = None
depends_on = None


def upgrade():
    # NOT NULL with a server default, so the rows already stored keep rendering
    # exactly as they do today rather than coming back with an empty side.
    op.execute(
        sa.text(
            "ALTER TABLE cinemaroomfloorplan "
            "ADD COLUMN IF NOT EXISTS screen_side VARCHAR(10) "
            "NOT NULL DEFAULT 'top'"
        )
    )


def downgrade():
    op.execute(
        sa.text("ALTER TABLE cinemaroomfloorplan DROP COLUMN IF EXISTS screen_side")
    )
