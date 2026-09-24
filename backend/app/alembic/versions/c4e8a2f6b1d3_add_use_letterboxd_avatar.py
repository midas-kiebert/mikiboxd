"""Add user.use_letterboxd_avatar

Opt-in for showing the account's Letterboxd profile picture as its avatar.
Defaults to off for everyone, existing accounts included: the picture was
never shown with explicit consent, so nobody starts opted in.

Also clears stored Letterboxd placeholder avatars (the generic silhouette on
``s.ltrbxd.com``), saved by syncs from before the scraper filtered them. A
sync that finds no picture leaves the stored value alone, so these would
otherwise never go away.

Forward DDL is idempotent so a partial/replayed run cannot wedge the backend.

Revision ID: c4e8a2f6b1d3
Revises: b8d4f1a6c3e9
Create Date: 2026-09-23 00:00:00.000000
"""

from alembic import op

revision = "c4e8a2f6b1d3"
down_revision = "b8d4f1a6c3e9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS '
        "use_letterboxd_avatar BOOLEAN NOT NULL DEFAULT false"
    )
    op.execute(
        "UPDATE letterboxd SET avatar_url = NULL "
        "WHERE avatar_url LIKE 'https://s.ltrbxd.com/%'"
    )


def downgrade() -> None:
    op.execute('ALTER TABLE "user" DROP COLUMN IF EXISTS use_letterboxd_avatar')
