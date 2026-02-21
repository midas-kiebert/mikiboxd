"""add showtime pings and notification toggles

Revision ID: f4a8c2d91b7e
Revises: cf1b92d4a6e7
Create Date: 2026-02-21 00:00:00.000000

"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "f4a8c2d91b7e"
down_revision = "cf1b92d4a6e7"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "user",
        sa.Column(
            "notify_on_friend_requests",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
    )
    op.add_column(
        "user",
        sa.Column(
            "notify_on_showtime_ping",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
    )
    op.add_column(
        "user",
        sa.Column(
            "notify_on_interest_reminder",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
    )
    op.alter_column(
        "user",
        "notify_on_friend_showtime_match",
        server_default=sa.true(),
    )

    op.create_table(
        "showtimeping",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("showtime_id", sa.Integer(), nullable=False),
        sa.Column("sender_id", sa.Uuid(), nullable=False),
        sa.Column("receiver_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("seen_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["showtime_id"], ["showtime.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["sender_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["receiver_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "showtime_id",
            "sender_id",
            "receiver_id",
            name="uq_showtime_ping_showtime_sender_receiver",
        ),
    )
    op.create_index("ix_showtimeping_showtime_id", "showtimeping", ["showtime_id"], unique=False)
    op.create_index("ix_showtimeping_sender_id", "showtimeping", ["sender_id"], unique=False)
    op.create_index("ix_showtimeping_receiver_id", "showtimeping", ["receiver_id"], unique=False)


def downgrade():
    op.drop_index("ix_showtimeping_receiver_id", table_name="showtimeping")
    op.drop_index("ix_showtimeping_sender_id", table_name="showtimeping")
    op.drop_index("ix_showtimeping_showtime_id", table_name="showtimeping")
    op.drop_table("showtimeping")

    op.alter_column(
        "user",
        "notify_on_friend_showtime_match",
        server_default=sa.false(),
    )
    op.drop_column("user", "notify_on_interest_reminder")
    op.drop_column("user", "notify_on_showtime_ping")
    op.drop_column("user", "notify_on_friend_requests")
