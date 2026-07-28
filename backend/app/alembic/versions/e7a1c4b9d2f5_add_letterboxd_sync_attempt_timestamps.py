"""Add last sync attempt / full-sync timestamps to the letterboxd table

`last_watchlist_sync` / `last_watched_sync` only record successes, so a user
whose scrape keeps failing (Letterboxd throttles the /films/ endpoint from
datacenter IPs) keeps a NULL timestamp forever and re-scrapes on every app
foreground. The `_attempt` columns record every attempt, which is what the sync
cooldown is checked against.

`last_watched_full_sync` separates "topped up from the RSS feed" from "walked
every /films/ page": the routine sync does the former, and the latter is what
reconciles un-watches and films marked watched without a diary entry.

Forward DDL is idempotent so a partial/replayed run cannot wedge the backend.

Revision ID: e7a1c4b9d2f5
Revises: b5d1c8e2f7a3
Create Date: 2026-07-28 12:00:00.000000
"""

from alembic import op

revision = "e7a1c4b9d2f5"
down_revision = "b5d1c8e2f7a3"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "ALTER TABLE letterboxd "
        "ADD COLUMN IF NOT EXISTS last_watchlist_sync_attempt TIMESTAMP"
    )
    op.execute(
        "ALTER TABLE letterboxd "
        "ADD COLUMN IF NOT EXISTS last_watched_sync_attempt TIMESTAMP"
    )
    op.execute(
        "ALTER TABLE letterboxd ADD COLUMN IF NOT EXISTS last_watched_full_sync TIMESTAMP"
    )
    # Seed from the known successes so the cooldown does not let every existing
    # user through at once on the first request after deploy.
    op.execute(
        "UPDATE letterboxd SET last_watchlist_sync_attempt = last_watchlist_sync "
        "WHERE last_watchlist_sync_attempt IS NULL"
    )
    op.execute(
        "UPDATE letterboxd SET last_watched_sync_attempt = last_watched_sync "
        "WHERE last_watched_sync_attempt IS NULL"
    )
    # Every existing success came from a full paginated walk, so seeding from it
    # avoids forcing a full re-walk for every user on the first sync after deploy.
    op.execute(
        "UPDATE letterboxd SET last_watched_full_sync = last_watched_sync "
        "WHERE last_watched_full_sync IS NULL"
    )


def downgrade():
    op.execute(
        "ALTER TABLE letterboxd DROP COLUMN IF EXISTS last_watchlist_sync_attempt"
    )
    op.execute("ALTER TABLE letterboxd DROP COLUMN IF EXISTS last_watched_sync_attempt")
    op.execute("ALTER TABLE letterboxd DROP COLUMN IF EXISTS last_watched_full_sync")
