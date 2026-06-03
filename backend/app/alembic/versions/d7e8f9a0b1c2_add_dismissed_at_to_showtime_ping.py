"""add dismissed_at to showtime_ping

Revision ID: d7e8f9a0b1c2
Revises: faa1b2c3d4e5
Create Date: 2026-06-04 12:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

revision = "d7e8f9a0b1c2"
down_revision = "faa1b2c3d4e5"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "showtimeping",
        sa.Column("dismissed_at", sa.DateTime(), nullable=True),
    )


def downgrade():
    op.drop_column("showtimeping", "dismissed_at")
