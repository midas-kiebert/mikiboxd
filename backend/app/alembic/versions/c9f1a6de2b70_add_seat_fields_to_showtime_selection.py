"""add seat fields to showtime selection

Revision ID: c9f1a6de2b70
Revises: ab47b34d8c2e
Create Date: 2026-02-28 12:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "c9f1a6de2b70"
down_revision = "ab47b34d8c2e"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "showtimeselection",
        sa.Column("seat_row", sa.String(length=32), nullable=True),
    )
    op.add_column(
        "showtimeselection",
        sa.Column("seat_number", sa.String(length=32), nullable=True),
    )


def downgrade():
    op.drop_column("showtimeselection", "seat_number")
    op.drop_column("showtimeselection", "seat_row")
