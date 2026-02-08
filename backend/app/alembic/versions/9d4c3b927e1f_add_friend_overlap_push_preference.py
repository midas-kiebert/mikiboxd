"""add friend overlap push preference

Revision ID: 9d4c3b927e1f
Revises: c12ab5f0c9d1
Create Date: 2026-02-08 00:00:00.000000

"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "9d4c3b927e1f"
down_revision = "c12ab5f0c9d1"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "user",
        sa.Column(
            "notify_on_friend_showtime_match",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade():
    op.drop_column("user", "notify_on_friend_showtime_match")
