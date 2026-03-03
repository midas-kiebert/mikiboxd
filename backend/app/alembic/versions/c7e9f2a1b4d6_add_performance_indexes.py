"""add performance indexes for showtime and visibility queries

Revision ID: c7e9f2a1b4d6
Revises: faa1b2c3d4e5
Create Date: 2026-03-04 10:10:00.000000
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "c7e9f2a1b4d6"
down_revision = "faa1b2c3d4e5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_showtimeselection_showtime_id_going_status",
        "showtimeselection",
        ["showtime_id", "going_status"],
        unique=False,
    )
    op.create_index(
        "ix_showtimeselection_showtime_id_user_id",
        "showtimeselection",
        ["showtime_id", "user_id"],
        unique=False,
    )
    op.create_index(
        "ix_friendship_friend_id_user_id",
        "friendship",
        ["friend_id", "user_id"],
        unique=False,
    )
    op.create_index(
        "ix_showtime_movie_id_datetime",
        "showtime",
        ["movie_id", "datetime"],
        unique=False,
    )
    op.create_index(
        "ix_friendgroup_owner_user_id_is_favorite",
        "friendgroup",
        ["owner_user_id", "is_favorite"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_friendgroup_owner_user_id_is_favorite", table_name="friendgroup")
    op.drop_index("ix_showtime_movie_id_datetime", table_name="showtime")
    op.drop_index("ix_friendship_friend_id_user_id", table_name="friendship")
    op.drop_index("ix_showtimeselection_showtime_id_user_id", table_name="showtimeselection")
    op.drop_index(
        "ix_showtimeselection_showtime_id_going_status", table_name="showtimeselection"
    )
