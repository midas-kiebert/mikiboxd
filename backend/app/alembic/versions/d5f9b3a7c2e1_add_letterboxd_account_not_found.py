"""Add letterboxd.account_not_found

Set when Letterboxd answers 404 for the linked username, so both clients can
warn that the account does not exist and offer to change it. Defaults to
false: an account nobody has checked yet is not known to be missing.

Forward DDL is idempotent so a partial/replayed run cannot wedge the backend.

Revision ID: d5f9b3a7c2e1
Revises: 9671961f3719
Create Date: 2026-09-23 00:00:00.000000
"""

from alembic import op

revision = "d5f9b3a7c2e1"
down_revision = "9671961f3719"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE letterboxd ADD COLUMN IF NOT EXISTS "
        "account_not_found BOOLEAN NOT NULL DEFAULT false"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE letterboxd DROP COLUMN IF EXISTS account_not_found")
