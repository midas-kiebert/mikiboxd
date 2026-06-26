"""add analytics_event and showtime_report tables

Revision ID: b1c2d3e4f5a6
Revises: a7c4e9b2d5f3
Create Date: 2026-06-27 00:00:00.000000

"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "b1c2d3e4f5a6"
down_revision = "a7c4e9b2d5f3"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "analyticsevent",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column(
            "name",
            sa.Enum(
                "login",
                "filter_applied",
                "preset_used",
                "invite_sent",
                "notification_clicked",
                name="name",
                native_enum=False,
            ),
            nullable=False,
        ),
        sa.Column("platform", sa.String(length=32), nullable=True),
        sa.Column("properties", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_analyticsevent_user_id", "analyticsevent", ["user_id"], unique=False
    )
    op.create_index(
        "ix_analyticsevent_name", "analyticsevent", ["name"], unique=False
    )
    op.create_index(
        "ix_analyticsevent_created_at", "analyticsevent", ["created_at"], unique=False
    )

    op.create_table(
        "showtimereport",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("showtime_id", sa.Integer(), nullable=False),
        sa.Column("reporter_id", sa.Uuid(), nullable=False),
        sa.Column(
            "reason",
            sa.Enum(
                "incorrect_movie",
                "incorrect_time",
                "does_not_exist",
                "duplicate",
                "other",
                name="reason",
                native_enum=False,
            ),
            nullable=False,
        ),
        sa.Column("message", sa.String(length=1000), nullable=True),
        sa.Column(
            "status",
            sa.Enum(
                "open",
                "resolved",
                "dismissed",
                name="status",
                native_enum=False,
            ),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("resolved_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["showtime_id"], ["showtime.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["reporter_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_showtimereport_showtime_id", "showtimereport", ["showtime_id"], unique=False
    )
    op.create_index(
        "ix_showtimereport_reporter_id", "showtimereport", ["reporter_id"], unique=False
    )
    op.create_index(
        "ix_showtimereport_status", "showtimereport", ["status"], unique=False
    )


def downgrade():
    op.drop_index("ix_showtimereport_status", table_name="showtimereport")
    op.drop_index("ix_showtimereport_reporter_id", table_name="showtimereport")
    op.drop_index("ix_showtimereport_showtime_id", table_name="showtimereport")
    op.drop_table("showtimereport")

    op.drop_index("ix_analyticsevent_created_at", table_name="analyticsevent")
    op.drop_index("ix_analyticsevent_name", table_name="analyticsevent")
    op.drop_index("ix_analyticsevent_user_id", table_name="analyticsevent")
    op.drop_table("analyticsevent")
