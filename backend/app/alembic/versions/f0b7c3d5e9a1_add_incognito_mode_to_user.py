"""add incognito mode toggle to user

Revision ID: f0b7c3d5e9a1
Revises: e1f4b7c8d9a0
Create Date: 2026-03-04 13:35:00.000000
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "f0b7c3d5e9a1"
down_revision = "e1f4b7c8d9a0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "user",
        sa.Column(
            "incognito_mode",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column("user", "incognito_mode")
