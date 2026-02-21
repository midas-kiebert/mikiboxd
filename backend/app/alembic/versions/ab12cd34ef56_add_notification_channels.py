"""add notification channels

Revision ID: ab12cd34ef56
Revises: 6d12f34ab890
Create Date: 2026-02-21 16:30:00.000000

"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "ab12cd34ef56"
down_revision = "6d12f34ab890"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "user",
        sa.Column(
            "notify_channel_friend_showtime_match",
            sa.String(length=16),
            nullable=False,
            server_default=sa.text("'push'"),
        ),
    )
    op.add_column(
        "user",
        sa.Column(
            "notify_channel_friend_requests",
            sa.String(length=16),
            nullable=False,
            server_default=sa.text("'push'"),
        ),
    )
    op.add_column(
        "user",
        sa.Column(
            "notify_channel_showtime_ping",
            sa.String(length=16),
            nullable=False,
            server_default=sa.text("'push'"),
        ),
    )
    op.add_column(
        "user",
        sa.Column(
            "notify_channel_interest_reminder",
            sa.String(length=16),
            nullable=False,
            server_default=sa.text("'push'"),
        ),
    )


def downgrade():
    op.drop_column("user", "notify_channel_interest_reminder")
    op.drop_column("user", "notify_channel_showtime_ping")
    op.drop_column("user", "notify_channel_friend_requests")
    op.drop_column("user", "notify_channel_friend_showtime_match")
