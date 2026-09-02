"""add showtime reminder cooldown

Revision ID: 769c74a47a70
Revises: e3a5c7b9d1f4
Create Date: 2026-09-02 11:06:32.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "769c74a47a70"
down_revision = "e3a5c7b9d1f4"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "showtimereminder",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("showtime_id", sa.Integer(), nullable=False),
        sa.Column("receiver_id", sa.Uuid(), nullable=False),
        sa.Column("sender_id", sa.Uuid(), nullable=False),
        sa.Column("sent_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["showtime_id"], ["showtime.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["receiver_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["sender_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "showtime_id",
            "receiver_id",
            name="uq_showtime_reminder_showtime_receiver",
        ),
    )
    op.create_index(
        "ix_showtimereminder_showtime_id",
        "showtimereminder",
        ["showtime_id"],
        unique=False,
    )
    op.create_index(
        "ix_showtimereminder_receiver_id",
        "showtimereminder",
        ["receiver_id"],
        unique=False,
    )


def downgrade():
    op.drop_index("ix_showtimereminder_receiver_id", table_name="showtimereminder")
    op.drop_index("ix_showtimereminder_showtime_id", table_name="showtimereminder")
    op.drop_table("showtimereminder")
