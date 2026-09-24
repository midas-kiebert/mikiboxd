"""Record when the app asked how an account wants to be notified

`user.app_notifications_prompted_at`: set when the app's notifications page
has been answered. An account without it gets that one page the first time it
signs in on the app — which is how an account made on the website is asked.

Backfilled for every account with a registered push token: those have already
been through the app's own notification prompt, so asking again would be
re-running setup for people who already use the app.

Also flips the database default of `notify_on_interest_reminder` to FALSE to
match the model: interest reminders are now off until switched on.

Forward DDL is idempotent so a replayed run can't wedge the backend.

Revision ID: c4f9a2e7d1b3
Revises: b8e4d2f6a1c9
Create Date: 2026-09-24 00:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

revision = "c4f9a2e7d1b3"
down_revision = "b8e4d2f6a1c9"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        sa.text(
            'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS '
            "app_notifications_prompted_at TIMESTAMP"
        )
    )
    op.execute(
        sa.text(
            'UPDATE "user" SET app_notifications_prompted_at = now() '
            "WHERE app_notifications_prompted_at IS NULL "
            "AND id IN (SELECT DISTINCT user_id FROM pushtoken)"
        )
    )
    op.execute(
        sa.text(
            'ALTER TABLE "user" ALTER COLUMN notify_on_interest_reminder '
            "SET DEFAULT FALSE"
        )
    )


def downgrade():
    op.execute(
        sa.text(
            'ALTER TABLE "user" ALTER COLUMN notify_on_interest_reminder '
            "SET DEFAULT TRUE"
        )
    )
    op.execute(
        sa.text(
            'ALTER TABLE "user" DROP COLUMN IF EXISTS app_notifications_prompted_at'
        )
    )
