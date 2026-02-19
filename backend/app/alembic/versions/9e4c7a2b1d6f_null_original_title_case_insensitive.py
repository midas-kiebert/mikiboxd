"""Null original_title when it equals title case-insensitively.

Revision ID: 9e4c7a2b1d6f
Revises: 7b3e2f4c1a90
Create Date: 2026-02-19 00:00:04.000000

"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "9e4c7a2b1d6f"
down_revision = "7b3e2f4c1a90"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        """
        UPDATE movie
        SET original_title = NULL
        WHERE original_title IS NOT NULL
          AND lower(btrim(original_title)) = lower(btrim(title))
        """
    )


def downgrade():
    # Not reversible: previous original_title values are not recoverable.
    pass
