"""add currently_listed to movie

Persistent per-movie flag: does the movie currently have a future showtime, as
of the last watchlist-digest refresh. The digest detects the not-listed ->
listed transition from it, so it isn't fooled by showtimes that were merely
deleted and re-created (churn) rather than the movie genuinely (re)appearing.

Existing movies are backfilled to their real current availability so the first
refresh after deploy sees no spurious transitions. Forward DDL is idempotent so
a replayed run can't wedge the backend.

Revision ID: c5d6e7f8a9b0
Revises: f1a2b3c4d5e6
Create Date: 2026-07-24 13:00:00.000000
"""

from alembic import op

revision = "c5d6e7f8a9b0"
down_revision = "f1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "ALTER TABLE movie ADD COLUMN IF NOT EXISTS currently_listed "
        "boolean NOT NULL DEFAULT false"
    )
    # Backfill to real current availability (has any future showtime) so the
    # first digest refresh after deploy doesn't treat every listed movie as new.
    op.execute(
        """
        UPDATE movie AS m
        SET currently_listed = true
        WHERE EXISTS (
            SELECT 1 FROM showtime s
            WHERE s.movie_id = m.id
              AND s.datetime > (now() AT TIME ZONE 'Europe/Amsterdam')
        )
          AND m.currently_listed = false
        """
    )


def downgrade():
    op.execute("ALTER TABLE movie DROP COLUMN IF EXISTS currently_listed")
