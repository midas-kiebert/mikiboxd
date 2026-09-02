"""add default_visibility_mode to user, drop show_friends_of_friends_interest

Replaces the "see friends of friends" opt-in (which gated a viewing
direction that is now unconditional) with a persisted default for the new
FRIENDS_OF_FRIENDS visibility mode — the mode a showtime starts with until
the user picks a different one for it (see
`crud.showtime_visibility.get_owner_default_mode_for_showtime`).

Forward DDL is idempotent so a replayed run can't wedge the backend.

Revision ID: b3d7f1a9c5e8
Revises: 769c74a47a70
Create Date: 2026-09-02 00:00:00.000000
"""

from alembic import op

revision = "b3d7f1a9c5e8"
down_revision = "769c74a47a70"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        'ALTER TABLE "user" '
        "ADD COLUMN IF NOT EXISTS default_visibility_mode varchar "
        "NOT NULL DEFAULT 'FRIENDS_OF_FRIENDS'"
    )
    op.execute(
        'ALTER TABLE "user" DROP COLUMN IF EXISTS show_friends_of_friends_interest'
    )


def downgrade():
    op.execute('ALTER TABLE "user" DROP COLUMN IF EXISTS default_visibility_mode')
    op.execute(
        'ALTER TABLE "user" '
        "ADD COLUMN IF NOT EXISTS show_friends_of_friends_interest boolean "
        "NOT NULL DEFAULT false"
    )
