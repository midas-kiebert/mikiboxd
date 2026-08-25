"""Merge the stored seat level floor `empty` into `some_taken`.

The busyness scale drops the emptiest rung: `empty` and `some_taken` were the
two least useful buckets to tell apart, and the client showed them with the
same single-person icon anyway. Every stored floor at `empty` moves to
`some_taken`, which now also owns the top cutoff (free >= 0.60) that used to
belong only to it.

`showtime.seats_level_floor` is a plain VARCHAR(40) with no check constraint
(the enum is mapped with `native_enum=False`), so this is a data rewrite and
nothing more. Left behind, the old string would raise `LookupError` the first
time SQLAlchemy tried to load one back into the enum.

Revision ID: a4c8e1f6d203
Revises: f3a9c1d7b5e2
Create Date: 2026-08-25

"""

from alembic import op

revision = "a4c8e1f6d203"
down_revision = "f3a9c1d7b5e2"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "UPDATE showtime SET seats_level_floor = 'some_taken' "
        "WHERE seats_level_floor = 'empty'"
    )


def downgrade():
    # `empty` has no reliable reconstruction from `some_taken` alone (the
    # merged bucket now spans both old ranges), so stored floors are left at
    # `some_taken` rather than guessed back apart; the ratchet re-raises the
    # right level from the next reading either way.
    pass
