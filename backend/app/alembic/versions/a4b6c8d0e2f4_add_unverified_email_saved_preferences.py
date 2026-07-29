"""Add user.unverified_email_saved_channels / unverified_email_saved_digest_enabled

Changing to a new email address makes the account unverified again (see
migration d4a8e2c6f1b9), and mail must not keep routing to an address nobody
has confirmed. These two columns are the bookkeeping that lets that switch be
temporary: `me_service.update_me` records which notify_channel_* fields were
EMAIL and whether the digest was on, flips them to push/off, and
`verify_email` (or a social sign-in that proves the same address) puts them
back once the address is confirmed again.

Forward DDL is idempotent so a partial/replayed run cannot wedge the backend.

Revision ID: a4b6c8d0e2f4
Revises: d3e5f7a9b1c2
Create Date: 2026-07-29 19:10:00.000000
"""

from alembic import op

revision = "a4b6c8d0e2f4"
down_revision = "d3e5f7a9b1c2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS '
        "unverified_email_saved_channels JSONB"
    )
    op.execute(
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS '
        "unverified_email_saved_digest_enabled BOOLEAN NOT NULL DEFAULT false"
    )


def downgrade() -> None:
    op.execute(
        'ALTER TABLE "user" DROP COLUMN IF EXISTS unverified_email_saved_channels'
    )
    op.execute(
        'ALTER TABLE "user" DROP COLUMN IF EXISTS '
        "unverified_email_saved_digest_enabled"
    )
