"""Add showtime-selection reminder tracking columns.

Revision ID: cf1b92d4a6e7
Revises: f2a4d6e8b0c1
Create Date: 2026-02-20 21:15:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "cf1b92d4a6e7"
down_revision = "f2a4d6e8b0c1"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "showtimeselection",
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )
    op.add_column(
        "showtimeselection",
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )
    op.add_column(
        "showtimeselection",
        sa.Column("interested_reminder_sent_at", sa.DateTime(), nullable=True),
    )

    op.execute(
        """
        UPDATE showtimeselection
        SET
            created_at = COALESCE(created_at, timezone('Europe/Amsterdam', now())),
            updated_at = COALESCE(updated_at, timezone('Europe/Amsterdam', now()))
        """
    )

    op.alter_column("showtimeselection", "created_at", nullable=False)
    op.alter_column("showtimeselection", "updated_at", nullable=False)


def downgrade():
    op.drop_column("showtimeselection", "interested_reminder_sent_at")
    op.drop_column("showtimeselection", "updated_at")
    op.drop_column("showtimeselection", "created_at")
