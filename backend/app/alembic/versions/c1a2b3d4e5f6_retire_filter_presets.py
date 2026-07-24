"""Retire the legacy filterpreset table; drop scope from savedpreset.

Filter presets and scoping are superseded by the unified, partial ``SavedPreset``
model. This migration:

1. Renames any savedpreset rows that collide on (owner_user_id, name) once scope
   is no longer part of the identity (two presets with the same name in
   different scopes), by suffixing later ones with " (2)", " (3)", etc.
2. Copies every real (user-owned) filterpreset row into savedpreset as a
   full-replacement preset (``untouched_fields=[]``, ``cinema_ids=NULL``),
   suffixing names that collide with the user's existing saved presets. The
   synthetic global "Default" rows (``owner_user_id IS NULL``) are not real
   data and are dropped along with the table.
3. Drops the ``scope`` column/index from savedpreset and swaps its unique
   constraint to (owner_user_id, name).
4. Drops the ``filterpreset`` table.

``cinemapreset`` is untouched — it backs an unrelated, still-live feature.

Revision ID: c1a2b3d4e5f6
Revises: b8e1f2a3c4d5
Create Date: 2026-06-20 13:00:00.000000

"""

import json
import uuid

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "c1a2b3d4e5f6"
down_revision = "b8e1f2a3c4d5"
branch_labels = None
depends_on = None


def _unique_name(name: str, used: set[str]) -> str:
    if name not in used:
        return name
    n = 2
    while f"{name} ({n})" in used:
        n += 1
    return f"{name} ({n})"


def upgrade():
    conn = op.get_bind()

    used_names: dict[uuid.UUID, set[str]] = {}
    saved_rows = conn.execute(
        sa.text(
            "SELECT id, owner_user_id, name FROM savedpreset ORDER BY created_at"
        )
    ).fetchall()
    for row in saved_rows:
        used = used_names.setdefault(row.owner_user_id, set())
        new_name = _unique_name(row.name, used)
        used.add(new_name)
        if new_name != row.name:
            conn.execute(
                sa.text("UPDATE savedpreset SET name = :name WHERE id = :id"),
                {"name": new_name, "id": row.id},
            )

    filter_rows = conn.execute(
        sa.text(
            "SELECT id, owner_user_id, name, is_favorite, filters, "
            "created_at, updated_at FROM filterpreset "
            "WHERE owner_user_id IS NOT NULL ORDER BY created_at"
        )
    ).fetchall()
    for row in filter_rows:
        used = used_names.setdefault(row.owner_user_id, set())
        new_name = _unique_name(row.name, used)
        used.add(new_name)
        conn.execute(
            sa.text(
                "INSERT INTO savedpreset "
                "(id, owner_user_id, name, is_favorite, untouched_fields, "
                "filters, cinema_ids, created_at, updated_at) "
                "VALUES (:id, :owner_user_id, :name, :is_favorite, "
                "CAST('[]' AS json), CAST(:filters AS json), NULL, "
                ":created_at, :updated_at)"
            ),
            {
                "id": uuid.uuid4(),
                "owner_user_id": row.owner_user_id,
                "name": new_name,
                "is_favorite": row.is_favorite,
                "filters": json.dumps(row.filters),
                "created_at": row.created_at,
                "updated_at": row.updated_at,
            },
        )

    op.drop_index(op.f("ix_savedpreset_scope"), table_name="savedpreset")
    op.drop_constraint(
        "uq_saved_preset_owner_scope_name", "savedpreset", type_="unique"
    )
    op.drop_column("savedpreset", "scope")
    op.create_unique_constraint(
        "uq_saved_preset_owner_name", "savedpreset", ["owner_user_id", "name"]
    )

    op.drop_table("filterpreset")


def downgrade():
    op.drop_constraint("uq_saved_preset_owner_name", "savedpreset", type_="unique")
    op.add_column(
        "savedpreset",
        sa.Column(
            "scope",
            sa.Enum("SHOWTIMES", "MOVIES", name="filterpresetscope", native_enum=False),
            nullable=True,
        ),
    )
    op.execute("UPDATE savedpreset SET scope = 'SHOWTIMES'")
    op.alter_column("savedpreset", "scope", nullable=False)
    op.create_index(op.f("ix_savedpreset_scope"), "savedpreset", ["scope"], unique=False)
    op.create_unique_constraint(
        "uq_saved_preset_owner_scope_name",
        "savedpreset",
        ["owner_user_id", "scope", "name"],
    )

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
    op.create_index(
        op.f("ix_filterpreset_is_default"), "filterpreset", ["is_default"], unique=False
    )
    op.create_index(
        op.f("ix_filterpreset_owner_user_id"),
        "filterpreset",
        ["owner_user_id"],
        unique=False,
    )
    op.create_index(op.f("ix_filterpreset_scope"), "filterpreset", ["scope"], unique=False)
