"""Add letterboxd_last_enriched_at to movie.

Revision ID: 8c6e9c4e7ab1
Revises: c4f2c6d9e321
Create Date: 2026-02-19 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "8c6e9c4e7ab1"
down_revision = "c4f2c6d9e321"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "movie",
        sa.Column("letterboxd_last_enriched_at", sa.DateTime(), nullable=True),
    )

    # Existing movies with a Letterboxd slug are treated as already enriched now.
    op.execute(
        """
        UPDATE movie
        SET letterboxd_last_enriched_at = NOW()
        WHERE letterboxd_slug IS NOT NULL
          AND letterboxd_last_enriched_at IS NULL
        """
    )


def downgrade():
    op.drop_column("movie", "letterboxd_last_enriched_at")
