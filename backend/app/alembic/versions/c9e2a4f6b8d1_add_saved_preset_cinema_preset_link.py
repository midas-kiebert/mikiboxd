"""add cinema_preset_id to savedpreset

Lets a saved (filter) preset follow a saved cinema preset live instead of
freezing a raw cinema selection: `cinema_ids`/`cinema_scope` stay as the
snapshot used as a fallback if the linked cinema preset is ever deleted (see
`crud.saved_preset.resolve_preset_cinema_ids`). No DB-level FK, matching the
other dangling-reference-tolerant preset columns
(`f1a2b3c4d5e6_add_watchlist_digest_cinema_preset.py`).

Forward DDL is idempotent so a replayed run can't wedge the backend.

Revision ID: c9e2a4f6b8d1
Revises: b4d6f8a0c2e4
Create Date: 2026-09-01 12:30:00.000000
"""

from alembic import op

revision = "c9e2a4f6b8d1"
down_revision = "b4d6f8a0c2e4"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "ALTER TABLE savedpreset ADD COLUMN IF NOT EXISTS cinema_preset_id uuid"
    )


def downgrade():
    op.execute("ALTER TABLE savedpreset DROP COLUMN IF EXISTS cinema_preset_id")
