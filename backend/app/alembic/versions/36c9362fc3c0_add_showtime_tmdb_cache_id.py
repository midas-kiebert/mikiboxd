"""add showtime tmdb_cache_id

Adds a per-showtime back-reference to the TmdbLookupCache entry that
resolved its movie. Movie.tmdb_cache_id alone isn't enough to scope an
admin cache correction: two different cache entries (e.g. from different
cinemas' scrapers) can resolve to the same movie_id, and Movie.tmdb_cache_id
only ever remembers whichever one upserted the Movie row last. With this
column, a correction can reassign exactly the showtimes that came from the
corrected cache entry instead of every showtime on the movie.

Forward DDL is idempotent so a partial/replayed run on staging cannot wedge
the backend.

Revision ID: 36c9362fc3c0
Revises: 627a211425b7
Create Date: 2026-07-25 00:00:00.000000
"""

from alembic import op

revision = "36c9362fc3c0"
down_revision = "627a211425b7"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "ALTER TABLE showtime ADD COLUMN IF NOT EXISTS tmdb_cache_id INTEGER "
        "REFERENCES tmdblookupcache(id)"
    )


def downgrade():
    op.execute("ALTER TABLE showtime DROP COLUMN IF EXISTS tmdb_cache_id")
