"""visibility modes and per-friend status sharing

Replaces the old per-showtime allow-lists + favorite friend-groups with:
  - a two-value visibility mode (ALL_FRIENDS / INVITED_ONLY) per showtime,
  - a per-friendship `shares_status` opt-out flag (default True).

Friend groups are retired entirely. All forward DDL is idempotent so a
partial/replayed run on staging cannot wedge the backend.

Revision ID: c7e9a1b3d5f2
Revises: b3c4d5e6f7a8
Create Date: 2026-06-22 12:00:00.000000
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "c7e9a1b3d5f2"
down_revision = "b3c4d5e6f7a8"
branch_labels = None
depends_on = None


def upgrade():
    # Per-friend status sharing (default on; opted-out friends only see on invite).
    op.execute(
        "ALTER TABLE friendship "
        "ADD COLUMN IF NOT EXISTS shares_status boolean NOT NULL DEFAULT true"
    )

    # Per-showtime visibility mode, backfilled from the old is_all_friends flag.
    op.execute(
        "ALTER TABLE showtimevisibilitysetting "
        "ADD COLUMN IF NOT EXISTS mode varchar NOT NULL DEFAULT 'ALL_FRIENDS'"
    )
    op.execute(
        "UPDATE showtimevisibilitysetting "
        "SET mode = CASE WHEN is_all_friends IS TRUE "
        "THEN 'ALL_FRIENDS' ELSE 'INVITED_ONLY' END"
    )
    op.execute(
        "ALTER TABLE showtimevisibilitysetting DROP COLUMN IF EXISTS is_all_friends"
    )

    # Retire the allow-list tables and friend groups entirely.
    op.execute("DROP TABLE IF EXISTS showtimevisibilityfriend")
    op.execute("DROP TABLE IF EXISTS showtimevisibilitygroup")
    op.execute("DROP TABLE IF EXISTS friendgroupmember")
    op.execute("DROP TABLE IF EXISTS friendgroup")


def downgrade():
    op.create_table(
        "friendgroup",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("owner_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column(
            "is_favorite", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
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
    op.create_index(
        "ix_friendgroup_owner_user_id_is_favorite",
        "friendgroup",
        ["owner_user_id", "is_favorite"],
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
        "showtimevisibilityfriend",
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("showtime_id", sa.Integer(), nullable=False),
        sa.Column("viewer_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["showtime_id"], ["showtime.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["viewer_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("owner_id", "showtime_id", "viewer_id"),
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

    op.execute(
        "ALTER TABLE showtimevisibilitysetting "
        "ADD COLUMN IF NOT EXISTS is_all_friends boolean NOT NULL DEFAULT true"
    )
    op.execute(
        "UPDATE showtimevisibilitysetting "
        "SET is_all_friends = (mode = 'ALL_FRIENDS')"
    )
    op.execute("ALTER TABLE showtimevisibilitysetting DROP COLUMN IF EXISTS mode")

    op.execute("ALTER TABLE friendship DROP COLUMN IF EXISTS shares_status")
