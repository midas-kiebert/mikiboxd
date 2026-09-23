"""Add letterboxd.avatar_url

The account's Letterboxd profile picture, read off the watchlist page a sync
already fetches (see `scraping/letterboxd/watchlist.extract_avatar_url_from_page`)
— no extra request, and re-read on every successful sync so a changed or
removed picture self-heals. Nullable and unbackfilled: it only fills in on
that account's next watchlist sync.

Forward DDL is idempotent so a partial/replayed run cannot wedge the backend.

Revision ID: b8d4f1a6c3e9
Revises: a5c1e9d3f7b2
Create Date: 2026-09-14 00:00:00.000000
"""

from alembic import op

revision = "b8d4f1a6c3e9"
down_revision = "a5c1e9d3f7b2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE letterboxd ADD COLUMN IF NOT EXISTS "
        "avatar_url VARCHAR(1024)"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE letterboxd DROP COLUMN IF EXISTS avatar_url")
