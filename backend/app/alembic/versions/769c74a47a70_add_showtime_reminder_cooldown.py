"""add showtime reminder cooldown

Revision ID: 769c74a47a70
Revises: e3a5c7b9d1f4
Create Date: 2026-09-02 11:06:32.000000

"""
from alembic import op


# revision identifiers, used by Alembic.
revision = "769c74a47a70"
down_revision = "e3a5c7b9d1f4"
branch_labels = None
depends_on = None


def upgrade():
    # Raw, idempotent DDL rather than `op.create_table`, matching every other
    # migration here: a replayed run (a deploy whose version row never stuck)
    # must not wedge the backend on "relation already exists".
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS showtimereminder (
            id SERIAL PRIMARY KEY,
            showtime_id INTEGER NOT NULL
                REFERENCES showtime (id) ON DELETE CASCADE,
            receiver_id UUID NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
            sender_id UUID NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
            sent_at TIMESTAMP NOT NULL,
            CONSTRAINT uq_showtime_reminder_showtime_receiver
                UNIQUE (showtime_id, receiver_id)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_showtimereminder_showtime_id "
        "ON showtimereminder (showtime_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_showtimereminder_receiver_id "
        "ON showtimereminder (receiver_id)"
    )


def downgrade():
    op.execute("DROP INDEX IF EXISTS ix_showtimereminder_receiver_id")
    op.execute("DROP INDEX IF EXISTS ix_showtimereminder_showtime_id")
    op.execute("DROP TABLE IF EXISTS showtimereminder")
