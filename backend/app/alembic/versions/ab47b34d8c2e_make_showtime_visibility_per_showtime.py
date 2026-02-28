"""make showtime visibility per showtime

Revision ID: ab47b34d8c2e
Revises: e5f6a7b8c9d0
Create Date: 2026-02-28 00:00:00.000000

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "ab47b34d8c2e"
down_revision = "e5f6a7b8c9d0"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "showtimevisibilitysetting_v2",
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("showtime_id", sa.Integer(), nullable=False),
        sa.Column("is_all_friends", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["showtime_id"], ["showtime.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("owner_id", "showtime_id"),
    )

    op.create_table(
        "showtimevisibilityfriend_v2",
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("showtime_id", sa.Integer(), nullable=False),
        sa.Column("viewer_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["showtime_id"], ["showtime.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["viewer_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("owner_id", "showtime_id", "viewer_id"),
    )

    op.execute(
        """
        INSERT INTO showtimevisibilitysetting_v2 (owner_id, showtime_id, is_all_friends, updated_at)
        SELECT setting.owner_id, showtime.id, setting.is_all_friends, setting.updated_at
        FROM showtimevisibilitysetting AS setting
        JOIN showtime ON showtime.movie_id = setting.movie_id
        """
    )
    op.execute(
        """
        INSERT INTO showtimevisibilityfriend_v2 (owner_id, showtime_id, viewer_id, created_at)
        SELECT friend.owner_id, showtime.id, friend.viewer_id, friend.created_at
        FROM showtimevisibilityfriend AS friend
        JOIN showtime ON showtime.movie_id = friend.movie_id
        """
    )

    op.drop_index("ix_showtimevisibilityfriend_viewer_id", table_name="showtimevisibilityfriend")
    op.drop_table("showtimevisibilityfriend")
    op.drop_table("showtimevisibilitysetting")

    op.rename_table("showtimevisibilitysetting_v2", "showtimevisibilitysetting")
    op.rename_table("showtimevisibilityfriend_v2", "showtimevisibilityfriend")
    op.create_index(
        "ix_showtimevisibilityfriend_viewer_id",
        "showtimevisibilityfriend",
        ["viewer_id"],
    )


def downgrade():
    op.create_table(
        "showtimevisibilitysetting_v1",
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("movie_id", sa.Integer(), nullable=False),
        sa.Column("is_all_friends", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["movie_id"], ["movie.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("owner_id", "movie_id"),
    )

    op.create_table(
        "showtimevisibilityfriend_v1",
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("movie_id", sa.Integer(), nullable=False),
        sa.Column("viewer_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["movie_id"], ["movie.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["viewer_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("owner_id", "movie_id", "viewer_id"),
    )

    op.execute(
        """
        INSERT INTO showtimevisibilitysetting_v1 (owner_id, movie_id, is_all_friends, updated_at)
        SELECT
          setting.owner_id,
          showtime.movie_id,
          CASE
            WHEN MIN(CASE WHEN setting.is_all_friends THEN 1 ELSE 0 END) = 1 THEN true
            ELSE false
          END AS is_all_friends,
          MAX(setting.updated_at) AS updated_at
        FROM showtimevisibilitysetting AS setting
        JOIN showtime ON showtime.id = setting.showtime_id
        GROUP BY setting.owner_id, showtime.movie_id
        """
    )
    op.execute(
        """
        INSERT INTO showtimevisibilityfriend_v1 (owner_id, movie_id, viewer_id, created_at)
        SELECT
          friend.owner_id,
          showtime.movie_id,
          friend.viewer_id,
          MAX(friend.created_at) AS created_at
        FROM showtimevisibilityfriend AS friend
        JOIN showtime ON showtime.id = friend.showtime_id
        GROUP BY friend.owner_id, showtime.movie_id, friend.viewer_id
        """
    )

    op.drop_index("ix_showtimevisibilityfriend_viewer_id", table_name="showtimevisibilityfriend")
    op.drop_table("showtimevisibilityfriend")
    op.drop_table("showtimevisibilitysetting")

    op.rename_table("showtimevisibilitysetting_v1", "showtimevisibilitysetting")
    op.rename_table("showtimevisibilityfriend_v1", "showtimevisibilityfriend")
    op.create_index(
        "ix_showtimevisibilityfriend_viewer_id",
        "showtimevisibilityfriend",
        ["viewer_id"],
    )
