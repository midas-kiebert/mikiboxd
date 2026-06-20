"""add letterboxd lists, list films and user-list link tables

Revision ID: 7f3a9c2b1e84
Revises: c1d2e3f4a5b6
Create Date: 2026-06-20 00:00:00.000000

"""

import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op

# revision identifiers, used by Alembic.
revision = "7f3a9c2b1e84"
down_revision = "c1d2e3f4a5b6"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "letterboxdlist",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("list_slug", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("title", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column(
            "boxd_shortcode", sqlmodel.sql.sqltypes.AutoString(), nullable=True
        ),
        sa.Column("is_curated", sa.Boolean(), nullable=False),
        sa.Column("last_updated_on_letterboxd", sa.DateTime(), nullable=True),
        sa.Column("last_synced", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "owner", "list_slug", name="uq_letterboxd_list_owner_slug"
        ),
    )
    op.create_index(
        op.f("ix_letterboxdlist_owner"), "letterboxdlist", ["owner"], unique=False
    )

    op.create_table(
        "letterboxdlistfilm",
        sa.Column("list_id", sa.Uuid(), nullable=False),
        sa.Column(
            "letterboxd_slug", sqlmodel.sql.sqltypes.AutoString(), nullable=False
        ),
        sa.Column("movie_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(
            ["list_id"], ["letterboxdlist.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["movie_id"], ["movie.id"]),
        sa.PrimaryKeyConstraint("list_id", "letterboxd_slug"),
    )

    op.create_table(
        "userletterboxdlist",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("list_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["list_id"], ["letterboxdlist.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("user_id", "list_id"),
    )


def downgrade():
    op.drop_table("userletterboxdlist")
    op.drop_table("letterboxdlistfilm")
    op.drop_index(op.f("ix_letterboxdlist_owner"), table_name="letterboxdlist")
    op.drop_table("letterboxdlist")
