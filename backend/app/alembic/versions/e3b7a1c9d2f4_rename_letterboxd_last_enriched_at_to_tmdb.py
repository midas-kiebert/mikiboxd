"""Rename letterboxd_last_enriched_at to tmdb_last_enriched_at.

Revision ID: e3b7a1c9d2f4
Revises: 8c6e9c4e7ab1
Create Date: 2026-02-19 00:00:00.000001

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "e3b7a1c9d2f4"
down_revision = "8c6e9c4e7ab1"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column(
        "movie",
        "letterboxd_last_enriched_at",
        new_column_name="tmdb_last_enriched_at",
        existing_type=sa.DateTime(),
        existing_nullable=True,
    )


def downgrade():
    op.alter_column(
        "movie",
        "tmdb_last_enriched_at",
        new_column_name="letterboxd_last_enriched_at",
        existing_type=sa.DateTime(),
        existing_nullable=True,
    )
