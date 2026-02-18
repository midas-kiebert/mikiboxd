"""Add TMDB lookup cache table.

Revision ID: c4f2c6d9e321
Revises: b2f3a1e7c4d9
Create Date: 2026-02-18 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "c4f2c6d9e321"
down_revision = "b2f3a1e7c4d9"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "tmdblookupcache",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("lookup_hash", sa.String(), nullable=False),
        sa.Column("lookup_payload", sa.String(), nullable=False),
        sa.Column("tmdb_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "lookup_hash",
            "lookup_payload",
            name="uq_tmdblookupcache_hash_payload",
        ),
    )
    op.create_index(
        op.f("ix_tmdblookupcache_lookup_hash"),
        "tmdblookupcache",
        ["lookup_hash"],
        unique=False,
    )
    op.create_index(
        op.f("ix_tmdblookupcache_created_at"),
        "tmdblookupcache",
        ["created_at"],
        unique=False,
    )
    op.create_index(
        op.f("ix_tmdblookupcache_updated_at"),
        "tmdblookupcache",
        ["updated_at"],
        unique=False,
    )


def downgrade():
    op.drop_index(op.f("ix_tmdblookupcache_updated_at"), table_name="tmdblookupcache")
    op.drop_index(op.f("ix_tmdblookupcache_created_at"), table_name="tmdblookupcache")
    op.drop_index(op.f("ix_tmdblookupcache_lookup_hash"), table_name="tmdblookupcache")
    op.drop_table("tmdblookupcache")
