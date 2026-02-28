"""add cinema seating preset

Revision ID: d1ab3f26c4e8
Revises: c9f1a6de2b70
Create Date: 2026-02-28 20:30:00.000000
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "d1ab3f26c4e8"
down_revision = "c9f1a6de2b70"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "cinema",
        sa.Column("seating", sa.String(length=40), nullable=False, server_default="unknown"),
    )


def downgrade():
    op.drop_column("cinema", "seating")
