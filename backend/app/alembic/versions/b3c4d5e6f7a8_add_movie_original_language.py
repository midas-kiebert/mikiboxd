"""add movie original_language

Adds a single "main spoken language" column sourced from TMDB's
``original_language``, distinct from the existing ``languages`` array
(which can include dubbed/secondary audio tracks and isn't reliable for
picking a single main language to filter on).

Revision ID: b3c4d5e6f7a8
Revises: d2e3f4a5b6c7
Create Date: 2026-06-21 12:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "b3c4d5e6f7a8"
down_revision = "d2e3f4a5b6c7"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "movie", sa.Column("original_language", sa.String(), nullable=True)
    )


def downgrade():
    op.drop_column("movie", "original_language")
