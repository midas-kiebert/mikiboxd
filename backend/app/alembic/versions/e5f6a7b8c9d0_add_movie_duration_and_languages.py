"""add movie duration and languages

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-02-26 01:15:00.000000

"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "e5f6a7b8c9d0"
down_revision = "d4e5f6a7b8c9"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("movie", sa.Column("duration", sa.Integer(), nullable=True))
    op.add_column(
        "movie",
        sa.Column("languages", postgresql.ARRAY(sa.String()), nullable=True),
    )


def downgrade():
    op.drop_column("movie", "languages")
    op.drop_column("movie", "duration")
