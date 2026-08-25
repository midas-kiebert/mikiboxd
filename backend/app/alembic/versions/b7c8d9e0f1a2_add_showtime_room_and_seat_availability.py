"""Add showtime.room and the seat-availability columns

`room` is the screen a showtime plays in, as the cinema names it ("LAB 1",
"Grote Zaal", "Cinema 3"). Eye's API and the Eagerly agenda feed carry it
already; for the Z-ELITE cinemas it comes off the checkout page the seat
availability poller fetches anyway.

`seats_left` / `seats_capacity` / `seats_checked_at` back the "tickets are
running low" warning. `seats_capacity` is a running max of every `seats_left`
reading rather than a modelled room capacity — see the model for why.

All three start NULL: nothing is known until the poller has run, and a NULL
seat count must never read as "sold out".

Forward DDL is idempotent so a partial/replayed run cannot wedge the backend.

Revision ID: b7c8d9e0f1a2
Revises: 13128ed3f0cf
Create Date: 2026-08-24 16:20:00.000000
"""

from alembic import op

revision = "b7c8d9e0f1a2"
down_revision = "13128ed3f0cf"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE showtime ADD COLUMN IF NOT EXISTS room VARCHAR")
    op.execute("ALTER TABLE showtime ADD COLUMN IF NOT EXISTS seats_left INTEGER")
    op.execute("ALTER TABLE showtime ADD COLUMN IF NOT EXISTS seats_capacity INTEGER")
    op.execute("ALTER TABLE showtime ADD COLUMN IF NOT EXISTS seats_checked_at TIMESTAMP")


def downgrade() -> None:
    op.execute("ALTER TABLE showtime DROP COLUMN IF EXISTS seats_checked_at")
    op.execute("ALTER TABLE showtime DROP COLUMN IF EXISTS seats_capacity")
    op.execute("ALTER TABLE showtime DROP COLUMN IF EXISTS seats_left")
    op.execute("ALTER TABLE showtime DROP COLUMN IF EXISTS room")
