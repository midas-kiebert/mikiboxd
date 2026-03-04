"""add denormalized showtime visibility effective table

Revision ID: e1f4b7c8d9a0
Revises: c7e9f2a1b4d6
Create Date: 2026-03-04 11:20:00.000000
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "e1f4b7c8d9a0"
down_revision = "c7e9f2a1b4d6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "showtimevisibilityeffective",
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("showtime_id", sa.Integer(), nullable=False),
        sa.Column("viewer_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["showtime_id"], ["showtime.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["viewer_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("owner_id", "showtime_id", "viewer_id"),
    )
    op.create_index(
        "ix_showtimevisibilityeffective_viewer_id",
        "showtimevisibilityeffective",
        ["viewer_id"],
        unique=False,
    )
    op.create_index(
        "ix_showtimevisibilityeffective_viewer_showtime_owner",
        "showtimevisibilityeffective",
        ["viewer_id", "showtime_id", "owner_id"],
        unique=False,
    )

    # Backfill effective edges for all current owner/showtime pairs that may be read.
    op.execute(
        """
        WITH owner_showtimes AS (
            SELECT DISTINCT s.user_id AS owner_id, s.showtime_id
            FROM showtimeselection AS s
            UNION
            SELECT DISTINCT svs.owner_id, svs.showtime_id
            FROM showtimevisibilitysetting AS svs
        ),
        favorite_group_counts AS (
            SELECT fg.owner_user_id AS owner_id, COUNT(*)::int AS favorite_count
            FROM friendgroup AS fg
            WHERE fg.is_favorite IS TRUE
            GROUP BY fg.owner_user_id
        ),
        all_friend_cases AS (
            SELECT os.owner_id, os.showtime_id
            FROM owner_showtimes AS os
            LEFT JOIN showtimevisibilitysetting AS svs
              ON svs.owner_id = os.owner_id
             AND svs.showtime_id = os.showtime_id
            LEFT JOIN favorite_group_counts AS fgc
              ON fgc.owner_id = os.owner_id
            WHERE
                (svs.owner_id IS NOT NULL AND svs.is_all_friends IS TRUE)
                OR (svs.owner_id IS NULL AND COALESCE(fgc.favorite_count, 0) = 0)
        ),
        all_friend_rows AS (
            SELECT af.owner_id, af.showtime_id, fr.friend_id AS viewer_id
            FROM all_friend_cases AS af
            JOIN friendship AS fr
              ON fr.user_id = af.owner_id
        ),
        favorite_default_cases AS (
            SELECT os.owner_id, os.showtime_id
            FROM owner_showtimes AS os
            LEFT JOIN showtimevisibilitysetting AS svs
              ON svs.owner_id = os.owner_id
             AND svs.showtime_id = os.showtime_id
            LEFT JOIN favorite_group_counts AS fgc
              ON fgc.owner_id = os.owner_id
            WHERE svs.owner_id IS NULL AND COALESCE(fgc.favorite_count, 0) > 0
        ),
        favorite_default_rows AS (
            SELECT fdc.owner_id, fdc.showtime_id, fgm.friend_id AS viewer_id
            FROM favorite_default_cases AS fdc
            JOIN friendgroup AS fg
              ON fg.owner_user_id = fdc.owner_id
             AND fg.is_favorite IS TRUE
            JOIN friendgroupmember AS fgm
              ON fgm.group_id = fg.id
            JOIN friendship AS fr
              ON fr.user_id = fdc.owner_id
             AND fr.friend_id = fgm.friend_id
        ),
        explicit_friend_rows AS (
            SELECT svf.owner_id, svf.showtime_id, svf.viewer_id
            FROM showtimevisibilityfriend AS svf
            JOIN showtimevisibilitysetting AS svs
              ON svs.owner_id = svf.owner_id
             AND svs.showtime_id = svf.showtime_id
            JOIN friendship AS fr
              ON fr.user_id = svf.owner_id
             AND fr.friend_id = svf.viewer_id
            WHERE svs.is_all_friends IS FALSE
        ),
        explicit_group_rows AS (
            SELECT svg.owner_id, svg.showtime_id, fgm.friend_id AS viewer_id
            FROM showtimevisibilitygroup AS svg
            JOIN showtimevisibilitysetting AS svs
              ON svs.owner_id = svg.owner_id
             AND svs.showtime_id = svg.showtime_id
            JOIN friendgroup AS fg
              ON fg.id = svg.group_id
             AND fg.owner_user_id = svg.owner_id
            JOIN friendgroupmember AS fgm
              ON fgm.group_id = fg.id
            JOIN friendship AS fr
              ON fr.user_id = svg.owner_id
             AND fr.friend_id = fgm.friend_id
            WHERE svs.is_all_friends IS FALSE
        ),
        all_rows AS (
            SELECT owner_id, showtime_id, viewer_id FROM all_friend_rows
            UNION
            SELECT owner_id, showtime_id, viewer_id FROM favorite_default_rows
            UNION
            SELECT owner_id, showtime_id, viewer_id FROM explicit_friend_rows
            UNION
            SELECT owner_id, showtime_id, viewer_id FROM explicit_group_rows
        )
        INSERT INTO showtimevisibilityeffective (owner_id, showtime_id, viewer_id)
        SELECT DISTINCT owner_id, showtime_id, viewer_id
        FROM all_rows
        """
    )


def downgrade() -> None:
    op.drop_index(
        "ix_showtimevisibilityeffective_viewer_showtime_owner",
        table_name="showtimevisibilityeffective",
    )
    op.drop_index(
        "ix_showtimevisibilityeffective_viewer_id",
        table_name="showtimevisibilityeffective",
    )
    op.drop_table("showtimevisibilityeffective")
