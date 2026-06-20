"""Replace savedpreset.included_fields with untouched_fields.

The saved-preset model flips from opt-in (apply only the listed dimensions) to
opt-out (control every dimension except the listed ones). This renames the
``included_fields`` column to ``untouched_fields`` and converts existing rows:
``untouched = UNTOUCHABLE_FIELDS - included_fields``. That preserves each
preset's prior "leave as-is" choices for the old dimensions while leaving newer
dimensions (Letterboxd lists) controlled — the new default.

Revision ID: b8e1f2a3c4d5
Revises: 7f3a9c2b1e84
Create Date: 2026-06-20 12:00:00.000000

"""

import json

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "b8e1f2a3c4d5"
down_revision = "7f3a9c2b1e84"
branch_labels = None
depends_on = None

# The non-list dimensions a preset can opt out of. Kept in sync with
# ``app.schemas.saved_preset.UNTOUCHABLE_FIELDS`` (cinemas excluded — opt-in).
UNTOUCHABLE_FIELDS = {
    "selected_showtime_filter",
    "showtime_audience",
    "watchlist_only",
    "hide_watched",
    "days",
    "time_ranges",
    "runtime_ranges",
    "group_by_movie",
}


def _convert(stored: list[str] | None, *, invert_from: set[str]) -> list[str]:
    return sorted(invert_from - set(stored or []))


def upgrade():
    op.add_column(
        "savedpreset", sa.Column("untouched_fields", sa.JSON(), nullable=True)
    )

    conn = op.get_bind()
    rows = conn.execute(
        sa.text("SELECT id, included_fields FROM savedpreset")
    ).fetchall()
    for row in rows:
        untouched = _convert(row.included_fields, invert_from=UNTOUCHABLE_FIELDS)
        conn.execute(
            sa.text(
                "UPDATE savedpreset SET untouched_fields = CAST(:value AS json) "
                "WHERE id = :id"
            ),
            {"value": json.dumps(untouched), "id": row.id},
        )

    op.alter_column(
        "savedpreset",
        "untouched_fields",
        nullable=False,
        server_default=sa.text("'[]'::json"),
    )
    op.drop_column("savedpreset", "included_fields")


def downgrade():
    op.add_column(
        "savedpreset", sa.Column("included_fields", sa.JSON(), nullable=True)
    )

    conn = op.get_bind()
    rows = conn.execute(
        sa.text("SELECT id, untouched_fields FROM savedpreset")
    ).fetchall()
    for row in rows:
        included = _convert(row.untouched_fields, invert_from=UNTOUCHABLE_FIELDS)
        conn.execute(
            sa.text(
                "UPDATE savedpreset SET included_fields = CAST(:value AS json) "
                "WHERE id = :id"
            ),
            {"value": json.dumps(included), "id": row.id},
        )

    op.alter_column("savedpreset", "included_fields", nullable=False)
    op.drop_column("savedpreset", "untouched_fields")
