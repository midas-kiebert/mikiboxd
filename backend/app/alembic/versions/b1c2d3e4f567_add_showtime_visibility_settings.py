"""add showtime visibility settings

Revision ID: b1c2d3e4f567
Revises: bc34de56fa78
Create Date: 2026-02-22 12:00:00.000000

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "b1c2d3e4f567"
down_revision = "bc34de56fa78"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "showtimevisibilitysetting",
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("movie_id", sa.Integer(), nullable=False),
        sa.Column("is_all_friends", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["movie_id"], ["movie.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["owner_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("owner_id", "movie_id"),
    )

    op.create_table(
        "showtimevisibilityfriend",
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("movie_id", sa.Integer(), nullable=False),
        sa.Column("viewer_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["movie_id"], ["movie.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["owner_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["viewer_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("owner_id", "movie_id", "viewer_id"),
    )

    op.create_index(
        "ix_showtimevisibilityfriend_viewer_id",
        "showtimevisibilityfriend",
        ["viewer_id"],
    )


def downgrade():
    op.drop_index("ix_showtimevisibilityfriend_viewer_id", table_name="showtimevisibilityfriend")
    op.drop_table("showtimevisibilityfriend")
    op.drop_table("showtimevisibilitysetting")
