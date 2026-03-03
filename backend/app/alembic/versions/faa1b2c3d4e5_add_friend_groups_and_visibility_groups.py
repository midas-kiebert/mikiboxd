"""add friend groups and showtime visibility groups

Revision ID: faa1b2c3d4e5
Revises: e8f6c1d2a3b4
Create Date: 2026-03-03 17:10:00.000000
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "faa1b2c3d4e5"
down_revision = "e8f6c1d2a3b4"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "friendgroup",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("owner_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("is_favorite", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["owner_user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("owner_user_id", "name", name="uq_friend_group_owner_name"),
    )
    op.create_index(
        op.f("ix_friendgroup_owner_user_id"),
        "friendgroup",
        ["owner_user_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_friendgroup_is_favorite"),
        "friendgroup",
        ["is_favorite"],
        unique=False,
    )

    op.create_table(
        "friendgroupmember",
        sa.Column("group_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("friend_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["group_id"], ["friendgroup.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["friend_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("group_id", "friend_id"),
    )
    op.create_index(
        op.f("ix_friendgroupmember_friend_id"),
        "friendgroupmember",
        ["friend_id"],
        unique=False,
    )

    op.create_table(
        "showtimevisibilitygroup",
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("showtime_id", sa.Integer(), nullable=False),
        sa.Column("group_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["showtime_id"], ["showtime.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["group_id"], ["friendgroup.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("owner_id", "showtime_id", "group_id"),
    )


def downgrade():
    op.drop_table("showtimevisibilitygroup")

    op.drop_index(op.f("ix_friendgroupmember_friend_id"), table_name="friendgroupmember")
    op.drop_table("friendgroupmember")

    op.drop_index(op.f("ix_friendgroup_is_favorite"), table_name="friendgroup")
    op.drop_index(op.f("ix_friendgroup_owner_user_id"), table_name="friendgroup")
    op.drop_table("friendgroup")
