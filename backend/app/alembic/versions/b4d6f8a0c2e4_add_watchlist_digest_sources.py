"""Add watchlist digest sources (multi-source digest configuration).

Replaces the single per-user digest configuration
(`notify_watchlist_digest_frequency`/`_list_id`/`_cinema_preset_id`/
`_last_sent_at`) with a `watchlistdigestsource` table: a user may now have
any number of digest sources, each with its own frequency, list/watchlist
source, and cinema restriction (a saved preset, or a one-off custom cinema
selection that is never saved as a preset).

Every currently-enabled user's existing single configuration is migrated
into exactly one source row, carrying over their frequency, chosen list,
chosen cinema preset, and last-sent timestamp — so nobody's active digest
changes shape or resets its "already notified" history. Users who have the
digest switched off are not migrated: their historical
`watchlistdigestnotifiedmovie` rows (which have no source to attach to) are
dropped, since they concern a feature that account was not actively using;
re-enabling the digest afterwards starts a fresh source, same as any
brand-new source.

All forward DDL is idempotent so a partial/replayed run on staging cannot
wedge the backend.

Revision ID: b4d6f8a0c2e4
Revises: d3e5f7a9b1c4
Create Date: 2026-09-01 12:00:00.000000
"""

from alembic import op

revision = "b4d6f8a0c2e4"
down_revision = "d3e5f7a9b1c4"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "CREATE TABLE IF NOT EXISTS watchlistdigestsource ("
        'id uuid NOT NULL PRIMARY KEY, '
        'owner_user_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, '
        "frequency varchar(40) NOT NULL DEFAULT 'weekly_or_urgent', "
        "list_id uuid, "
        "cinema_preset_id uuid, "
        "custom_cinema_ids json, "
        "last_sent_at timestamp, "
        "created_at timestamp NOT NULL DEFAULT now()"
        ")"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_watchlistdigestsource_owner_user_id "
        "ON watchlistdigestsource (owner_user_id)"
    )

    # One source per currently-enabled user, carrying over their existing
    # single-source configuration verbatim.
    op.execute(
        "INSERT INTO watchlistdigestsource "
        "(id, owner_user_id, frequency, list_id, cinema_preset_id, "
        "last_sent_at, created_at) "
        "SELECT uuid_generate_v4(), id, notify_watchlist_digest_frequency, "
        "notify_watchlist_digest_list_id, notify_watchlist_digest_cinema_preset_id, "
        "notify_watchlist_digest_last_sent_at, now() "
        'FROM "user" WHERE notify_watchlist_digest_enabled = true'
    )

    op.execute(
        "ALTER TABLE watchlistdigestnotifiedmovie "
        "ADD COLUMN IF NOT EXISTS source_id uuid"
    )
    op.execute(
        "UPDATE watchlistdigestnotifiedmovie n "
        "SET source_id = s.id "
        "FROM watchlistdigestsource s "
        "WHERE s.owner_user_id = n.user_id"
    )
    # Rows that found no source belong to users who had the digest off — that
    # history has nothing left to attach to.
    op.execute("DELETE FROM watchlistdigestnotifiedmovie WHERE source_id IS NULL")
    op.execute(
        "ALTER TABLE watchlistdigestnotifiedmovie ALTER COLUMN source_id SET NOT NULL"
    )
    op.execute(
        "ALTER TABLE watchlistdigestnotifiedmovie "
        "DROP CONSTRAINT IF EXISTS watchlistdigestnotifiedmovie_pkey"
    )
    op.execute(
        "ALTER TABLE watchlistdigestnotifiedmovie "
        "ADD PRIMARY KEY (source_id, movie_id)"
    )
    op.execute(
        "ALTER TABLE watchlistdigestnotifiedmovie "
        "DROP CONSTRAINT IF EXISTS watchlistdigestnotifiedmovie_user_id_fkey"
    )
    op.execute("ALTER TABLE watchlistdigestnotifiedmovie DROP COLUMN IF EXISTS user_id")
    op.execute(
        "ALTER TABLE watchlistdigestnotifiedmovie "
        "ADD CONSTRAINT watchlistdigestnotifiedmovie_source_id_fkey "
        "FOREIGN KEY (source_id) REFERENCES watchlistdigestsource(id) ON DELETE CASCADE"
    )

    op.execute(
        'ALTER TABLE "user" DROP COLUMN IF EXISTS notify_watchlist_digest_frequency'
    )
    op.execute(
        'ALTER TABLE "user" DROP COLUMN IF EXISTS notify_watchlist_digest_list_id'
    )
    op.execute(
        'ALTER TABLE "user" '
        "DROP COLUMN IF EXISTS notify_watchlist_digest_cinema_preset_id"
    )
    op.execute(
        'ALTER TABLE "user" DROP COLUMN IF EXISTS notify_watchlist_digest_last_sent_at'
    )


def downgrade():
    op.execute(
        'ALTER TABLE "user" '
        "ADD COLUMN IF NOT EXISTS notify_watchlist_digest_frequency varchar(40) "
        "NOT NULL DEFAULT 'weekly_or_urgent'"
    )
    op.execute(
        'ALTER TABLE "user" '
        "ADD COLUMN IF NOT EXISTS notify_watchlist_digest_list_id uuid"
    )
    op.execute(
        'ALTER TABLE "user" '
        "ADD COLUMN IF NOT EXISTS notify_watchlist_digest_cinema_preset_id uuid"
    )
    op.execute(
        'ALTER TABLE "user" '
        "ADD COLUMN IF NOT EXISTS notify_watchlist_digest_last_sent_at timestamp"
    )
    # Best-effort: carries back whichever one source an account had (the
    # oldest one, if a user created several after upgrading — those extra
    # ones have nowhere to go back to and are simply dropped).
    op.execute(
        "UPDATE \"user\" u SET "
        "notify_watchlist_digest_frequency = s.frequency, "
        "notify_watchlist_digest_list_id = s.list_id, "
        "notify_watchlist_digest_cinema_preset_id = s.cinema_preset_id, "
        "notify_watchlist_digest_last_sent_at = s.last_sent_at "
        "FROM ("
        "SELECT DISTINCT ON (owner_user_id) * FROM watchlistdigestsource "
        "ORDER BY owner_user_id, created_at"
        ") s WHERE s.owner_user_id = u.id"
    )

    op.execute(
        "ALTER TABLE watchlistdigestnotifiedmovie ADD COLUMN IF NOT EXISTS user_id uuid"
    )
    op.execute(
        "UPDATE watchlistdigestnotifiedmovie n "
        "SET user_id = s.owner_user_id "
        "FROM watchlistdigestsource s "
        "WHERE s.id = n.source_id"
    )
    op.execute(
        "ALTER TABLE watchlistdigestnotifiedmovie ALTER COLUMN user_id SET NOT NULL"
    )
    op.execute(
        "ALTER TABLE watchlistdigestnotifiedmovie "
        "DROP CONSTRAINT IF EXISTS watchlistdigestnotifiedmovie_pkey"
    )
    op.execute(
        "DELETE FROM watchlistdigestnotifiedmovie a USING watchlistdigestnotifiedmovie b "
        "WHERE a.user_id = b.user_id AND a.movie_id = b.movie_id "
        "AND a.ctid < b.ctid"
    )
    op.execute(
        "ALTER TABLE watchlistdigestnotifiedmovie ADD PRIMARY KEY (user_id, movie_id)"
    )
    op.execute(
        "ALTER TABLE watchlistdigestnotifiedmovie "
        "DROP CONSTRAINT IF EXISTS watchlistdigestnotifiedmovie_source_id_fkey"
    )
    op.execute("ALTER TABLE watchlistdigestnotifiedmovie DROP COLUMN IF EXISTS source_id")
    op.execute(
        "ALTER TABLE watchlistdigestnotifiedmovie "
        "ADD CONSTRAINT watchlistdigestnotifiedmovie_user_id_fkey "
        'FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE CASCADE'
    )

    op.execute("DROP TABLE IF EXISTS watchlistdigestsource")
