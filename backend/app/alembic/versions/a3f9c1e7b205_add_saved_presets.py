"""Add saved presets table.

A ``SavedPreset`` stores a partial filter selection (``included_fields`` +
``filters``) plus an optional cinema selection (``cinema_ids``). It is additive:
the legacy ``filterpreset`` and ``cinemapreset`` tables are left untouched.

Revision ID: a3f9c1e7b205
Revises: d7e8f9a0b1c2
Create Date: 2026-06-04 13:00:00.000000

"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "a3f9c1e7b205"
down_revision = "d7e8f9a0b1c2"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "savedpreset",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("owner_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column(
            "scope",
            sa.Enum("SHOWTIMES", "MOVIES", name="filterpresetscope", native_enum=False),
            nullable=False,
        ),
        sa.Column(
            "is_favorite", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
        sa.Column("included_fields", sa.JSON(), nullable=False),
        sa.Column("filters", sa.JSON(), nullable=False),
        sa.Column("cinema_ids", sa.JSON(), nullable=True),
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
            "scope",
            "name",
            name="uq_saved_preset_owner_scope_name",
        ),
    )
    op.create_index(
        op.f("ix_savedpreset_is_favorite"), "savedpreset", ["is_favorite"], unique=False
    )
    op.create_index(
        op.f("ix_savedpreset_owner_user_id"),
        "savedpreset",
        ["owner_user_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_savedpreset_scope"), "savedpreset", ["scope"], unique=False
    )


def downgrade():
    op.drop_index(op.f("ix_savedpreset_scope"), table_name="savedpreset")
    op.drop_index(op.f("ix_savedpreset_owner_user_id"), table_name="savedpreset")
    op.drop_index(op.f("ix_savedpreset_is_favorite"), table_name="savedpreset")
    op.drop_table("savedpreset")
