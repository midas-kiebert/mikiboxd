"""add apple_refresh_token to user

Stores Apple's refresh token per account so that deleting an account can revoke
the user's Sign in with Apple tokens, which Apple requires of any app offering
it (App Store Review guideline 5.1.1(v)). See app/core/apple_auth.py.

Forward DDL is idempotent so a partial or replayed run on staging cannot wedge
the backend.

Revision ID: e2f3a4b5c6d7
Revises: e1f2a3b4c5d6
Create Date: 2026-08-18 12:05:00.000000
"""

from alembic import op

revision = "e2f3a4b5c6d7"
down_revision = "e1f2a3b4c5d6"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS apple_refresh_token VARCHAR'
    )


def downgrade():
    op.execute('ALTER TABLE "user" DROP COLUMN IF EXISTS apple_refresh_token')
