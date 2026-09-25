"""Film festivals: cinema kinds, and a festival + Cineville pass per showtime

`cinema.kind`: "cinema", "venue" (a place that only shows films during a
festival) or "festival" (the festival itself). Every existing row is a cinema.

`showtime.festival_id`: the festival cinema a screening belongs to, for the
festival badge. `cinema_id` stays the real location.

`showtime.cineville_pass`: whether the Cineville pass covers the screening.
NULL means "same as the cinema"; only festival screenings set it.

Forward DDL is idempotent so a replayed run can't wedge the backend.

Revision ID: d2a7f5c3e8b1
Revises: c4f9a2e7d1b3
Create Date: 2026-09-25 00:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

revision = "d2a7f5c3e8b1"
down_revision = "c4f9a2e7d1b3"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        sa.text(
            "ALTER TABLE cinema ADD COLUMN IF NOT EXISTS "
            "kind VARCHAR(20) NOT NULL DEFAULT 'cinema'"
        )
    )
    op.execute(
        sa.text(
            "ALTER TABLE showtime ADD COLUMN IF NOT EXISTS "
            "festival_id INTEGER REFERENCES cinema(id) ON DELETE SET NULL"
        )
    )
    op.execute(
        sa.text(
            "CREATE INDEX IF NOT EXISTS ix_showtime_festival_id "
            "ON showtime (festival_id)"
        )
    )
    op.execute(
        sa.text("ALTER TABLE showtime ADD COLUMN IF NOT EXISTS cineville_pass BOOLEAN")
    )


def downgrade():
    op.execute(sa.text("ALTER TABLE showtime DROP COLUMN IF EXISTS cineville_pass"))
    op.execute(sa.text("DROP INDEX IF EXISTS ix_showtime_festival_id"))
    op.execute(sa.text("ALTER TABLE showtime DROP COLUMN IF EXISTS festival_id"))
    op.execute(sa.text("ALTER TABLE cinema DROP COLUMN IF EXISTS kind"))
