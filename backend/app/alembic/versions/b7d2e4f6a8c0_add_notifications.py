"""add notification centre table and invite-response toggle

Revision ID: b7d2e4f6a8c0
Revises: a3f9c1e7b205
Create Date: 2026-06-06 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "b7d2e4f6a8c0"
down_revision = "a3f9c1e7b205"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "user",
        sa.Column(
            "notify_on_invite_response",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
    )
    op.add_column(
        "user",
        sa.Column(
            "notify_channel_invite_response",
            sa.String(length=16),
            nullable=False,
            server_default=sa.text("'PUSH'"),
        ),
    )

    # Timestamp so the notification centre can time-sort received friend requests.
    op.add_column(
        "friendrequest",
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )

    op.create_table(
        "notification",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column(
            "type",
            sa.Enum(
                "friend_showtime_match",
                "invite_response",
                "friend_request_accepted",
                name="notificationtype",
                native_enum=False,
            ),
            nullable=False,
        ),
        sa.Column("actor_id", sa.Uuid(), nullable=True),
        sa.Column("showtime_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("seen_at", sa.DateTime(), nullable=True),
        sa.Column("dismissed_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["actor_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["showtime_id"], ["showtime.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id",
            "type",
            "actor_id",
            "showtime_id",
            name="uq_notification_user_type_actor_showtime",
        ),
    )
    op.create_index(
        "ix_notification_user_id", "notification", ["user_id"], unique=False
    )
    op.create_index(
        "ix_notification_actor_id", "notification", ["actor_id"], unique=False
    )
    op.create_index(
        "ix_notification_showtime_id", "notification", ["showtime_id"], unique=False
    )


def downgrade():
    op.drop_index("ix_notification_showtime_id", table_name="notification")
    op.drop_index("ix_notification_actor_id", table_name="notification")
    op.drop_index("ix_notification_user_id", table_name="notification")
    op.drop_table("notification")

    op.drop_column("friendrequest", "created_at")
    op.drop_column("user", "notify_channel_invite_response")
    op.drop_column("user", "notify_on_invite_response")
