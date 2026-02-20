"""Add filter presets table.

Revision ID: c8f1b2d3e4f5
Revises: 9e4c7a2b1d6f
Create Date: 2026-02-20 14:15:00.000000

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "c8f1b2d3e4f5"
down_revision = "9e4c7a2b1d6f"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "filterpreset",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("owner_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column(
            "scope",
            sa.Enum("SHOWTIMES", "MOVIES", name="filterpresetscope", native_enum=False),
            nullable=False,
        ),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("filters", sa.JSON(), nullable=False),
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
            name="uq_filter_preset_owner_scope_name",
        ),
    )
    op.create_index(op.f("ix_filterpreset_is_default"), "filterpreset", ["is_default"], unique=False)
    op.create_index(op.f("ix_filterpreset_owner_user_id"), "filterpreset", ["owner_user_id"], unique=False)
    op.create_index(op.f("ix_filterpreset_scope"), "filterpreset", ["scope"], unique=False)


def downgrade():
    op.drop_index(op.f("ix_filterpreset_scope"), table_name="filterpreset")
    op.drop_index(op.f("ix_filterpreset_owner_user_id"), table_name="filterpreset")
    op.drop_index(op.f("ix_filterpreset_is_default"), table_name="filterpreset")
    op.drop_table("filterpreset")
