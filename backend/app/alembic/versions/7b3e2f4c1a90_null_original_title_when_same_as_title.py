"""Null original_title when it equals title.

Revision ID: 7b3e2f4c1a90
Revises: 4d8c2a1f0b7e
Create Date: 2026-02-19 00:00:03.000000

"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "7b3e2f4c1a90"
down_revision = "4d8c2a1f0b7e"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        """
        UPDATE movie
        SET original_title = NULL
        WHERE original_title IS NOT NULL
          AND btrim(original_title) = btrim(title)
        """
    )


def downgrade():
    # Not reversible: previous original_title values are not recoverable.
    pass
