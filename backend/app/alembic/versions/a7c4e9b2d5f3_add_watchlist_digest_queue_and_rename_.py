"""add watchlist digest queue/notified tables, rename weekly frequency

Adds:
  - `watchlistdigestqueueentry`: movies that just became newly available,
    recorded once, ever, by the daily digest discovery job.
  - `watchlistdigestnotifiedmovie`: per-user record of movies already sent
    (or already known via an existing GOING/INTERESTED selection) so they
    are never sent to that user again.

Also renames the "weekly" digest frequency value to "weekly_or_urgent" to
reflect that it can now fire early when a pending showtime is coming up soon.

All forward DDL is idempotent so a partial/replayed run on staging cannot
wedge the backend.

Revision ID: a7c4e9b2d5f3
Revises: e4f5a6b7c8d9
Create Date: 2026-06-26 15:00:00.000000
"""

from alembic import op

revision = "a7c4e9b2d5f3"
down_revision = "e4f5a6b7c8d9"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "CREATE TABLE IF NOT EXISTS watchlistdigestqueueentry ("
        "movie_id integer NOT NULL REFERENCES movie(id) ON DELETE CASCADE PRIMARY KEY, "
        "added_at timestamp NOT NULL"
        ")"
    )
    op.execute(
        "CREATE TABLE IF NOT EXISTS watchlistdigestnotifiedmovie ("
        'user_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, '
        "movie_id integer NOT NULL REFERENCES movie(id) ON DELETE CASCADE, "
        "notified_at timestamp NOT NULL, "
        "PRIMARY KEY (user_id, movie_id)"
        ")"
    )
    op.execute(
        'ALTER TABLE "user" ALTER COLUMN notify_watchlist_digest_frequency '
        "SET DEFAULT 'weekly_or_urgent'"
    )
    op.execute(
        'UPDATE "user" SET notify_watchlist_digest_frequency = \'weekly_or_urgent\' '
        "WHERE notify_watchlist_digest_frequency = 'weekly'"
    )


def downgrade():
    op.execute(
        'UPDATE "user" SET notify_watchlist_digest_frequency = \'weekly\' '
        "WHERE notify_watchlist_digest_frequency = 'weekly_or_urgent'"
    )
    op.execute(
        'ALTER TABLE "user" ALTER COLUMN notify_watchlist_digest_frequency '
        "SET DEFAULT 'weekly'"
    )
    op.execute("DROP TABLE IF EXISTS watchlistdigestnotifiedmovie")
    op.execute("DROP TABLE IF EXISTS watchlistdigestqueueentry")
