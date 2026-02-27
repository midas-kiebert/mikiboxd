"""add confidence to tmdb lookup cache

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-02-26 00:30:00.000000

"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "d4e5f6a7b8c9"
down_revision = "c3d4e5f6a7b8"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("tmdblookupcache", sa.Column("confidence", sa.Float(), nullable=True))


def downgrade():
    op.drop_column("tmdblookupcache", "confidence")
