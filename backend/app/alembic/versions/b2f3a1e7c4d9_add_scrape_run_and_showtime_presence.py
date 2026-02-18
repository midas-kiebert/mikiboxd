"""Add scrape run tracking and restore showtime selection cascade.

Revision ID: b2f3a1e7c4d9
Revises: 9d4c3b927e1f
Create Date: 2026-02-18 00:00:00.000000

"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "b2f3a1e7c4d9"
down_revision = "9d4c3b927e1f"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    # Recreate FK with ON DELETE CASCADE so stale showtimes can be deleted safely.
    for fk in inspector.get_foreign_keys("showtimeselection"):
        if (
            fk.get("referred_table") == "showtime"
            and fk.get("constrained_columns") == ["showtime_id"]
            and fk.get("name")
        ):
            op.drop_constraint(
                fk["name"],
                "showtimeselection",
                type_="foreignkey",
            )
            break
    op.create_foreign_key(
        "showtimeselection_showtime_id_fkey",
        "showtimeselection",
        "showtime",
        ["showtime_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.create_table(
        "scraperun",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("source_stream", sa.String(), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "SUCCESS",
                "FAILED",
                "DEGRADED",
                name="scraperunstatus",
                native_enum=False,
            ),
            nullable=False,
        ),
        sa.Column("started_at", sa.DateTime(), nullable=False),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.Column("observed_showtime_count", sa.Integer(), nullable=True),
        sa.Column("error", sa.String(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_scraperun_source_stream"),
        "scraperun",
        ["source_stream"],
        unique=False,
    )
    op.create_index(
        op.f("ix_scraperun_started_at"),
        "scraperun",
        ["started_at"],
        unique=False,
    )

    op.create_table(
        "showtimesourcepresence",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("source_stream", sa.String(), nullable=False),
        sa.Column("source_event_key", sa.String(), nullable=False),
        sa.Column("showtime_id", sa.Integer(), nullable=False),
        sa.Column("last_seen_run_id", sa.Integer(), nullable=True),
        sa.Column("last_seen_at", sa.DateTime(), nullable=False),
        sa.Column("missing_streak", sa.Integer(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(
            ["last_seen_run_id"],
            ["scraperun.id"],
        ),
        sa.ForeignKeyConstraint(
            ["showtime_id"],
            ["showtime.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "source_stream",
            "source_event_key",
            name="uq_showtime_source_event",
        ),
    )
    op.create_index(
        op.f("ix_showtimesourcepresence_active"),
        "showtimesourcepresence",
        ["active"],
        unique=False,
    )
    op.create_index(
        op.f("ix_showtimesourcepresence_last_seen_at"),
        "showtimesourcepresence",
        ["last_seen_at"],
        unique=False,
    )
    op.create_index(
        op.f("ix_showtimesourcepresence_last_seen_run_id"),
        "showtimesourcepresence",
        ["last_seen_run_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_showtimesourcepresence_showtime_id"),
        "showtimesourcepresence",
        ["showtime_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_showtimesourcepresence_source_event_key"),
        "showtimesourcepresence",
        ["source_event_key"],
        unique=False,
    )
    op.create_index(
        op.f("ix_showtimesourcepresence_source_stream"),
        "showtimesourcepresence",
        ["source_stream"],
        unique=False,
    )


def downgrade():
    op.drop_index(
        op.f("ix_showtimesourcepresence_source_stream"),
        table_name="showtimesourcepresence",
    )
    op.drop_index(
        op.f("ix_showtimesourcepresence_source_event_key"),
        table_name="showtimesourcepresence",
    )
    op.drop_index(
        op.f("ix_showtimesourcepresence_showtime_id"),
        table_name="showtimesourcepresence",
    )
    op.drop_index(
        op.f("ix_showtimesourcepresence_last_seen_run_id"),
        table_name="showtimesourcepresence",
    )
    op.drop_index(
        op.f("ix_showtimesourcepresence_last_seen_at"),
        table_name="showtimesourcepresence",
    )
    op.drop_index(
        op.f("ix_showtimesourcepresence_active"),
        table_name="showtimesourcepresence",
    )
    op.drop_table("showtimesourcepresence")

    op.drop_index(op.f("ix_scraperun_started_at"), table_name="scraperun")
    op.drop_index(op.f("ix_scraperun_source_stream"), table_name="scraperun")
    op.drop_table("scraperun")

    op.drop_constraint(
        "showtimeselection_showtime_id_fkey",
        "showtimeselection",
        type_="foreignkey",
    )
    op.create_foreign_key(
        "showtimeselection_showtime_id_fkey",
        "showtimeselection",
        "showtime",
        ["showtime_id"],
        ["id"],
    )
