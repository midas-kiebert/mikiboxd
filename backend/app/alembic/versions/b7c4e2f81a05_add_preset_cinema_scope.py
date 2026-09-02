"""add cinema_scope to cinemapreset and savedpreset

A preset stored the cinema ids the user had ticked, and nothing about why. New
cinemas open every few months, so "everything in Amsterdam" quietly decayed
into "those four Amsterdam cinemas that existed when I saved this".

This adds the rule behind the selection. The frozen id list stays as it is —
it is still what a preset falls back to, and what every client reads — while
`cinema_scope` says whether the user picked everything, whole cities, or
individual cinemas, so reads can expand it against the current cinema list.

The backfill infers that rule for presets that already exist, from the same
coverage test used at save time: a preset that currently selects every cinema
in a city starts following that city. Presets whose coverage is partial get an
explicit-ids scope and keep behaving exactly as they did.

Forward DDL is idempotent so a replayed run can't wedge the backend.

Revision ID: b7c4e2f81a05
Revises: d4e7b2a9c6f1
Create Date: 2026-08-28 00:00:00.000000
"""

import json
from collections import defaultdict

import sqlalchemy as sa
from alembic import op

revision = "b7c4e2f81a05"
down_revision = "d4e7b2a9c6f1"
branch_labels = None
depends_on = None

# Mirrors ``app.crud.cinema_scope.CITY_SCOPE_MINIMUM_CINEMAS``. Duplicated
# rather than imported: a migration has to keep meaning what it meant on the
# day it ran, even after the constant moves.
CITY_SCOPE_MINIMUM_CINEMAS = 2

PRESET_TABLES = ("cinemapreset", "savedpreset")


def _infer_scope(
    selected: set[int],
    every_id: set[int],
    cinemas_by_city: dict[int, set[int]],
) -> dict[str, object]:
    if every_id and selected >= every_id:
        return {"all_cinemas": True, "city_ids": [], "cinema_ids": []}

    covered: set[int] = set()
    city_ids: list[int] = []
    for city_id, city_cinema_ids in cinemas_by_city.items():
        if len(city_cinema_ids) < CITY_SCOPE_MINIMUM_CINEMAS:
            continue
        if city_cinema_ids <= selected:
            city_ids.append(city_id)
            covered |= city_cinema_ids

    return {
        "all_cinemas": False,
        "city_ids": sorted(city_ids),
        "cinema_ids": sorted(selected - covered),
    }


def upgrade():
    for table in PRESET_TABLES:
        op.execute(
            sa.text(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS cinema_scope JSON")
        )

    connection = op.get_bind()

    cinemas_by_city: dict[int, set[int]] = defaultdict(set)
    every_id: set[int] = set()
    for cinema_id, city_id in connection.execute(sa.text("SELECT id, city_id FROM cinema")):
        cinemas_by_city[city_id].add(cinema_id)
        every_id.add(cinema_id)

    if not every_id:
        # Nothing to infer against (a fresh database); presets created from here
        # on get their scope written at save time.
        return

    for table in PRESET_TABLES:
        rows = connection.execute(
            sa.text(
                f"SELECT id, cinema_ids FROM {table} "  # noqa: S608 - fixed table names
                "WHERE cinema_scope IS NULL AND cinema_ids IS NOT NULL"
            )
        ).fetchall()
        for preset_id, cinema_ids in rows:
            selected = {int(value) for value in (cinema_ids or [])}
            if not selected:
                # An empty selection carries no rule — same as at save time.
                continue
            scope = _infer_scope(selected, every_id, cinemas_by_city)
            connection.execute(
                sa.text(
                    f"UPDATE {table} SET cinema_scope = CAST(:scope AS JSON) "  # noqa: S608
                    "WHERE id = :preset_id"
                ),
                {"scope": json.dumps(scope), "preset_id": preset_id},
            )


def downgrade():
    for table in PRESET_TABLES:
        op.execute(sa.text(f"ALTER TABLE {table} DROP COLUMN IF EXISTS cinema_scope"))
