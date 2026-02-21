"""fix notification channel enum storage

Revision ID: bc34de56fa78
Revises: ab12cd34ef56
Create Date: 2026-02-21 16:20:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "bc34de56fa78"
down_revision = "ab12cd34ef56"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "UPDATE \"user\" "
        "SET notify_channel_friend_showtime_match = "
        "CASE notify_channel_friend_showtime_match "
        "WHEN 'push' THEN 'PUSH' "
        "WHEN 'email' THEN 'EMAIL' "
        "ELSE notify_channel_friend_showtime_match END"
    )
    op.execute(
        "UPDATE \"user\" "
        "SET notify_channel_friend_requests = "
        "CASE notify_channel_friend_requests "
        "WHEN 'push' THEN 'PUSH' "
        "WHEN 'email' THEN 'EMAIL' "
        "ELSE notify_channel_friend_requests END"
    )
    op.execute(
        "UPDATE \"user\" "
        "SET notify_channel_showtime_ping = "
        "CASE notify_channel_showtime_ping "
        "WHEN 'push' THEN 'PUSH' "
        "WHEN 'email' THEN 'EMAIL' "
        "ELSE notify_channel_showtime_ping END"
    )
    op.execute(
        "UPDATE \"user\" "
        "SET notify_channel_interest_reminder = "
        "CASE notify_channel_interest_reminder "
        "WHEN 'push' THEN 'PUSH' "
        "WHEN 'email' THEN 'EMAIL' "
        "ELSE notify_channel_interest_reminder END"
    )

    op.alter_column(
        "user",
        "notify_channel_friend_showtime_match",
        server_default=sa.text("'PUSH'"),
    )
    op.alter_column(
        "user",
        "notify_channel_friend_requests",
        server_default=sa.text("'PUSH'"),
    )
    op.alter_column(
        "user",
        "notify_channel_showtime_ping",
        server_default=sa.text("'PUSH'"),
    )
    op.alter_column(
        "user",
        "notify_channel_interest_reminder",
        server_default=sa.text("'PUSH'"),
    )


def downgrade():
    op.execute(
        "UPDATE \"user\" "
        "SET notify_channel_friend_showtime_match = "
        "CASE notify_channel_friend_showtime_match "
        "WHEN 'PUSH' THEN 'push' "
        "WHEN 'EMAIL' THEN 'email' "
        "ELSE notify_channel_friend_showtime_match END"
    )
    op.execute(
        "UPDATE \"user\" "
        "SET notify_channel_friend_requests = "
        "CASE notify_channel_friend_requests "
        "WHEN 'PUSH' THEN 'push' "
        "WHEN 'EMAIL' THEN 'email' "
        "ELSE notify_channel_friend_requests END"
    )
    op.execute(
        "UPDATE \"user\" "
        "SET notify_channel_showtime_ping = "
        "CASE notify_channel_showtime_ping "
        "WHEN 'PUSH' THEN 'push' "
        "WHEN 'EMAIL' THEN 'email' "
        "ELSE notify_channel_showtime_ping END"
    )
    op.execute(
        "UPDATE \"user\" "
        "SET notify_channel_interest_reminder = "
        "CASE notify_channel_interest_reminder "
        "WHEN 'PUSH' THEN 'push' "
        "WHEN 'EMAIL' THEN 'email' "
        "ELSE notify_channel_interest_reminder END"
    )

    op.alter_column(
        "user",
        "notify_channel_friend_showtime_match",
        server_default=sa.text("'push'"),
    )
    op.alter_column(
        "user",
        "notify_channel_friend_requests",
        server_default=sa.text("'push'"),
    )
    op.alter_column(
        "user",
        "notify_channel_showtime_ping",
        server_default=sa.text("'push'"),
    )
    op.alter_column(
        "user",
        "notify_channel_interest_reminder",
        server_default=sa.text("'push'"),
    )
