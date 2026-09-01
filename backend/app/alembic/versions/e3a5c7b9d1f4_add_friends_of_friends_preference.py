"""add show_friends_of_friends_interest to user

Opt-in preference: on a showtime, also surface friends of the viewer's
friends who are GOING/INTERESTED, reachable only through a mutual friend who
is themself GOING/INTERESTED and only when that mutual friend can already
see the friend-of-friend's status (see
`crud.showtime.get_friends_of_friends_for_showtime`).

Forward DDL is idempotent so a replayed run can't wedge the backend.

Revision ID: e3a5c7b9d1f4
Revises: d1f3a5b7c9e2
Create Date: 2026-09-01 13:30:00.000000
"""

from alembic import op

revision = "e3a5c7b9d1f4"
down_revision = "d1f3a5b7c9e2"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        'ALTER TABLE "user" '
        "ADD COLUMN IF NOT EXISTS show_friends_of_friends_interest boolean "
        "NOT NULL DEFAULT false"
    )


def downgrade():
    op.execute(
        'ALTER TABLE "user" DROP COLUMN IF EXISTS show_friends_of_friends_interest'
    )
