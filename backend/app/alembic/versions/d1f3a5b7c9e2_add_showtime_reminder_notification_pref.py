"""add notify_on_showtime_reminder / notify_channel_showtime_reminder to user

Backs the "send a reminder" feature: a user can nudge a friend who is
already GOING/INTERESTED on a showtime, or invited to it and hasn't
dismissed the invite. This one preference gates both directions — whether
the user receives such a nudge, and whether the mobile app offers them the
button to send one to their own friends.

Forward DDL is idempotent so a replayed run can't wedge the backend.

Revision ID: d1f3a5b7c9e2
Revises: c9e2a4f6b8d1
Create Date: 2026-09-01 13:00:00.000000
"""

from alembic import op

revision = "d1f3a5b7c9e2"
down_revision = "c9e2a4f6b8d1"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        'ALTER TABLE "user" '
        "ADD COLUMN IF NOT EXISTS notify_on_showtime_reminder boolean "
        "NOT NULL DEFAULT true"
    )
    # Stored by the enum member's *name*, not its value — 'PUSH'/'EMAIL',
    # matching every other notify_channel_* column (see
    # bc34de56fa78_fix_notification_channel_enum_storage.py). Getting this
    # wrong crashes every read of the user table, not just this column: the
    # ORM decodes the whole row through NotificationChannel, and a stored
    # value that isn't a valid member name (lowercase 'push') raises.
    op.execute(
        'ALTER TABLE "user" '
        "ADD COLUMN IF NOT EXISTS notify_channel_showtime_reminder varchar(16) "
        "NOT NULL DEFAULT 'PUSH'"
    )


def downgrade():
    op.execute(
        'ALTER TABLE "user" DROP COLUMN IF EXISTS notify_channel_showtime_reminder'
    )
    op.execute('ALTER TABLE "user" DROP COLUMN IF EXISTS notify_on_showtime_reminder')
