"""key floor plans by room_key, not by room name

Floor plans were filed under the room's *name*, on the assumption that every
ticketing platform prints one. Ticketlab does not: of its fourteen shops only
Focus, Wenneker and Cinema Middelburg put a room row on the checkout page —
Cinema Oostereiland, De Drom, Filmhuis Bussum, Fizi and Luxor Zutphen list
film, date and time and nothing else. Those rooms could therefore never be
named, so `Showtime.room` stayed null, so no plan was ever ingested for them
and none could have been found if it had been.

Every seated Ticketlab page does carry `util.seating.locationid`, the shop's
own id for the room, the same number for every show in it. That is what a
plan is now keyed by: `cinemaroomfloorplan.room` becomes `room_key` (for the
platforms that name rooms it keeps holding the name, unchanged), the display
name moves to the nullable `room_name`, and `showtime.room_key` is the
matching column the poller fills in beside `showtime.room`.

Existing rows are backfilled key = name = what they already held, so no plan
outside Ticketlab moves. The Ticketlab plans are dropped instead: they are
keyed by a name the poller will now no longer write, and the ingest re-reads
them under their `locationid` on the next deploy.

Forward DDL is idempotent so a replayed run can't wedge the backend.

Revision ID: d2f6b8a4c1e9
Revises: b3d7f1a9c5e8
Create Date: 2026-09-02 00:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

revision = "d2f6b8a4c1e9"
down_revision = "b3d7f1a9c5e8"
branch_labels = None
depends_on = None

# Every Ticketlab shop. Only three of them ever yielded a plan, and those
# three are keyed by a room name the poller will no longer write — so all
# fourteen are cleared and `ingest-seat-floor-plans.py` re-reads them keyed by
# `locationid` on the next deploy.
_TICKETLAB_CINEMA_KEYS = (
    "artishock",
    "cinema-middelburg",
    "cinema-oostereiland",
    "de-cacaofabriek",
    "de-drom",
    "filmhuis-bussum",
    "filmhuis-zevenaar",
    "filmtheater-voorschoten",
    "fizi",
    "flora",
    "focus-filmtheater",
    "fraterhuis",
    "luxor-theater",
    "wenneker-cinema",
)


def upgrade():
    if _has_column("cinemaroomfloorplan", "room"):
        op.execute(
            sa.text("ALTER TABLE cinemaroomfloorplan RENAME COLUMN room TO room_key")
        )
    op.execute(
        sa.text(
            "ALTER TABLE cinemaroomfloorplan "
            "ADD COLUMN IF NOT EXISTS room_name VARCHAR(255)"
        )
    )
    # Everything stored so far was keyed by the name, so the name is what the
    # key column now holds — copying it across leaves every existing plan
    # rendering with the header it had.
    op.execute(
        sa.text(
            "UPDATE cinemaroomfloorplan SET room_name = room_key "
            "WHERE room_name IS NULL"
        )
    )
    op.execute(
        sa.text(
            "DELETE FROM cinemaroomfloorplan f USING cinema c "
            "WHERE c.id = f.cinema_id AND c.key = ANY(:keys)"
        ).bindparams(sa.bindparam("keys", list(_TICKETLAB_CINEMA_KEYS)))
    )

    op.execute(
        sa.text("ALTER TABLE showtime ADD COLUMN IF NOT EXISTS room_key VARCHAR(255)")
    )
    # Everywhere but Ticketlab the key is the name, and the poller only ever
    # writes this column when it reads a page — so without a backfill every
    # showtime already polled would lose its seat map until its next reading.
    op.execute(sa.text("UPDATE showtime SET room_key = room WHERE room_key IS NULL"))


def downgrade():
    op.execute(sa.text("ALTER TABLE showtime DROP COLUMN IF EXISTS room_key"))
    op.execute(
        sa.text("ALTER TABLE cinemaroomfloorplan DROP COLUMN IF EXISTS room_name")
    )
    if _has_column("cinemaroomfloorplan", "room_key"):
        op.execute(
            sa.text("ALTER TABLE cinemaroomfloorplan RENAME COLUMN room_key TO room")
        )


def _has_column(table: str, column: str) -> bool:
    """Postgres has no `RENAME COLUMN IF EXISTS`, so the guard is a lookup."""
    return bool(
        op.get_bind()
        .execute(
            sa.text(
                "SELECT 1 FROM information_schema.columns "
                "WHERE table_name = :table AND column_name = :column"
            ),
            {"table": table, "column": column},
        )
        .first()
    )
