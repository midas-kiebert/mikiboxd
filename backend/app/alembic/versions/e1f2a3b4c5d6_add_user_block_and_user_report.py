"""add user block and user report tables

The two records App Store Review guideline 1.2 requires a social app to keep:
who a user refuses contact from, and who they have flagged for moderation.

`userblock` is one row per direction (see models/user_block.py) so that each
side can block independently. `userreport` mirrors `showtimereport` — same
triage states, different subject.

Forward DDL is idempotent (CREATE ... IF NOT EXISTS throughout) so a partial or
replayed run on staging cannot wedge the backend.

Revision ID: e1f2a3b4c5d6
Revises: b4d6e8f0a2c4
Create Date: 2026-08-18 12:00:00.000000
"""

from alembic import op

revision = "e1f2a3b4c5d6"
down_revision = "b4d6e8f0a2c4"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS userblock (
            blocker_id UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
            blocked_id UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
            created_at TIMESTAMP NOT NULL,
            PRIMARY KEY (blocker_id, blocked_id)
        )
        """
    )
    # Both directions are queried on every visibility/contact check: the
    # primary key already covers blocker_id, so only the reverse lookup
    # ("who has blocked me") needs an index of its own.
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_userblock_blocked_id "
        "ON userblock (blocked_id)"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS userreport (
            id SERIAL PRIMARY KEY,
            reporter_id UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
            reported_id UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
            reason VARCHAR NOT NULL,
            message VARCHAR(1000),
            status VARCHAR NOT NULL DEFAULT 'open',
            created_at TIMESTAMP NOT NULL,
            resolved_at TIMESTAMP
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_userreport_reporter_id "
        "ON userreport (reporter_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_userreport_reported_id "
        "ON userreport (reported_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_userreport_status ON userreport (status)"
    )


def downgrade():
    op.execute("DROP TABLE IF EXISTS userreport")
    op.execute("DROP TABLE IF EXISTS userblock")
