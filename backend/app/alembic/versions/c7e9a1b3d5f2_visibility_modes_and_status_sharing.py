"""visibility modes and favorite friends

Replaces the per-showtime is_all_friends flag + friend/group allow-lists with a
single visibility mode (ALL_FRIENDS / FAVORITE_FRIENDS / INVITED_ONLY), adds a
per-friendship favorite flag and a per-user default visibility mode.

All DDL is idempotent so a partial/replayed run on staging cannot wedge the
backend.

Revision ID: c7e9a1b3d5f2
Revises: b3c4d5e6f7a8
Create Date: 2026-06-22 12:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

revision = "c7e9a1b3d5f2"
down_revision = "b3c4d5e6f7a8"
branch_labels = None
depends_on = None


def upgrade():
    # Per-friend favorite flag (per-owner: stored on the user_id row).
    op.execute(
        "ALTER TABLE friendship "
        "ADD COLUMN IF NOT EXISTS is_favorite boolean NOT NULL DEFAULT false"
    )

    # Per-user default visibility mode (NULL until the user picks one).
    op.execute(
        'ALTER TABLE "user" '
        "ADD COLUMN IF NOT EXISTS default_visibility_mode varchar NULL"
    )

    # Per-showtime visibility mode, backfilled from the old is_all_friends flag.
    op.execute(
        "ALTER TABLE showtimevisibilitysetting "
        "ADD COLUMN IF NOT EXISTS mode varchar NOT NULL "
        "DEFAULT 'FAVORITE_FRIENDS'"
    )
    op.execute(
        "UPDATE showtimevisibilitysetting "
        "SET mode = 'ALL_FRIENDS' "
        "WHERE is_all_friends IS TRUE"
    )
    op.execute(
        "ALTER TABLE showtimevisibilitysetting DROP COLUMN IF EXISTS is_all_friends"
    )

    # The arbitrary friend/group allow-lists are no longer used — visibility is
    # now derived from mode + favorites + pings into ShowtimeVisibilityEffective.
    op.execute("DROP TABLE IF EXISTS showtimevisibilityfriend")
    op.execute("DROP TABLE IF EXISTS showtimevisibilitygroup")


def downgrade():
    op.create_table(
        "showtimevisibilityfriend",
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("showtime_id", sa.Integer(), nullable=False),
        sa.Column("viewer_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["showtime_id"], ["showtime.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["viewer_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("owner_id", "showtime_id", "viewer_id"),
    )
    op.create_table(
        "showtimevisibilitygroup",
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("showtime_id", sa.Integer(), nullable=False),
        sa.Column("group_id", sa.Uuid(), nullable=False),
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
    op.execute(
        "ALTER TABLE showtimevisibilitysetting DROP COLUMN IF EXISTS mode"
    )

    op.execute(
        'ALTER TABLE "user" DROP COLUMN IF EXISTS default_visibility_mode'
    )
    op.execute("ALTER TABLE friendship DROP COLUMN IF EXISTS is_favorite")
