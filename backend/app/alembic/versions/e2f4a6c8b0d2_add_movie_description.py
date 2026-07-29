"""Add movie.description column.

TMDB scrapes now capture the plot synopsis (``overview``) so it can be
shown in the app; store it alongside the other TMDB-sourced fields.

Revision ID: e2f4a6c8b0d2
Revises: a4b6c8d0e2f4
Create Date: 2026-07-29 00:00:00.000000

"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "e2f4a6c8b0d2"
down_revision = "a4b6c8d0e2f4"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE movie ADD COLUMN IF NOT EXISTS description VARCHAR")


def downgrade():
    op.drop_column("movie", "description")
