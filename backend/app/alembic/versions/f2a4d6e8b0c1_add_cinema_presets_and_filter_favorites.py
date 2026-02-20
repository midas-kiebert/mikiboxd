"""Add cinema presets and filter favorite flags.

Revision ID: f2a4d6e8b0c1
Revises: c8f1b2d3e4f5
Create Date: 2026-02-20 18:30:00.000000

"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "f2a4d6e8b0c1"
down_revision = "c8f1b2d3e4f5"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "filterpreset",
        sa.Column(
            "is_favorite",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.create_index(
        op.f("ix_filterpreset_is_favorite"),
        "filterpreset",
        ["is_favorite"],
        unique=False,
    )

    op.create_table(
        "cinemapreset",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("owner_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("cinema_ids", sa.JSON(), nullable=False),
        sa.Column("is_favorite", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["owner_user_id"],
            ["user.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "owner_user_id",
            "name",
            name="uq_cinema_preset_owner_name",
        ),
    )
    op.create_index(
        op.f("ix_cinemapreset_owner_user_id"),
        "cinemapreset",
        ["owner_user_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_cinemapreset_is_favorite"),
        "cinemapreset",
        ["is_favorite"],
        unique=False,
    )


def downgrade():
    op.drop_index(op.f("ix_cinemapreset_is_favorite"), table_name="cinemapreset")
    op.drop_index(op.f("ix_cinemapreset_owner_user_id"), table_name="cinemapreset")
    op.drop_table("cinemapreset")

    op.drop_index(op.f("ix_filterpreset_is_favorite"), table_name="filterpreset")
    op.drop_column("filterpreset", "is_favorite")
