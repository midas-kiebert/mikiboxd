"""Rename the stored seat level floor `nearly_sold_out` to `last_few`.

The busyness scale gained a rung: what used to be the single "nearly sold out"
bucket is now `very_busy` (10–40% of the room free) and `last_few` (under 10%,
or six seats and fewer). The old value's *meaning* is the new `last_few` — it
fired on exactly those cutoffs — so every stored floor moves there, not to
`very_busy`.

`showtime.seats_level_floor` is a plain VARCHAR(40) with no check constraint
(the enum is mapped with `native_enum=False`), so this is a data rewrite and
nothing more. Left behind, the old strings would raise `LookupError` the first
time SQLAlchemy tried to load one back into the enum.

Revision ID: e1a7c3f9b204
Revises: c3f1a90d4e77
Create Date: 2026-08-25

"""

from alembic import op

revision = "e1a7c3f9b204"
down_revision = "c3f1a90d4e77"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "UPDATE showtime SET seats_level_floor = 'last_few' "
        "WHERE seats_level_floor = 'nearly_sold_out'"
    )


def downgrade():
    # `very_busy` has no pre-split equivalent and is dropped to NULL rather than
    # invented: the ratchet re-raises it from the next reading either way.
    op.execute(
        "UPDATE showtime SET seats_level_floor = 'nearly_sold_out' "
        "WHERE seats_level_floor = 'last_few'"
    )
    op.execute(
        "UPDATE showtime SET seats_level_floor = NULL "
        "WHERE seats_level_floor = 'very_busy'"
    )
