"""add push tokens

Revision ID: c12ab5f0c9d1
Revises: 86dcd90174a0
Create Date: 2026-02-06 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "c12ab5f0c9d1"
down_revision = "86dcd90174a0"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "pushtoken",
        sa.Column("token", sa.String(length=255), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("platform", sa.String(length=32), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"]),
        sa.PrimaryKeyConstraint("token"),
    )
    op.create_index("ix_pushtoken_user_id", "pushtoken", ["user_id"], unique=False)


def downgrade():
    op.drop_index("ix_pushtoken_user_id", table_name="pushtoken")
    op.drop_table("pushtoken")
