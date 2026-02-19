"""Drop rating and top250 columns from movie.

Revision ID: 4d8c2a1f0b7e
Revises: e3b7a1c9d2f4
Create Date: 2026-02-19 00:00:02.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "4d8c2a1f0b7e"
down_revision = "e3b7a1c9d2f4"
branch_labels = None
depends_on = None


def upgrade():
    op.drop_column("movie", "rating")
    op.drop_column("movie", "top250")


def downgrade():
    op.add_column("movie", sa.Column("top250", sa.Integer(), nullable=True))
    op.add_column("movie", sa.Column("rating", sa.Float(), nullable=True))
