"""add analytics_event and showtime_report tables

All forward DDL is idempotent so a partial/replayed run on staging cannot
wedge the backend.

Revision ID: b1c2d3e4f5a6
Revises: a7c4e9b2d5f3
Create Date: 2026-06-27 00:00:00.000000

"""

from alembic import op

revision = "b1c2d3e4f5a6"
down_revision = "a7c4e9b2d5f3"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "CREATE TABLE IF NOT EXISTS analyticsevent ("
        "id SERIAL NOT NULL PRIMARY KEY, "
        'user_id UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, '
        "name VARCHAR(20) NOT NULL, "
        "platform VARCHAR(32), "
        "properties JSON, "
        "created_at TIMESTAMP NOT NULL"
        ")"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_analyticsevent_user_id "
        "ON analyticsevent (user_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_analyticsevent_name ON analyticsevent (name)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_analyticsevent_created_at "
        "ON analyticsevent (created_at)"
    )

    op.execute(
        "CREATE TABLE IF NOT EXISTS showtimereport ("
        "id SERIAL NOT NULL PRIMARY KEY, "
        "showtime_id integer NOT NULL REFERENCES showtime(id) ON DELETE CASCADE, "
        'reporter_id UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, '
        "reason VARCHAR(16) NOT NULL, "
        "message VARCHAR(1000), "
        "status VARCHAR(9) NOT NULL, "
        "created_at TIMESTAMP NOT NULL, "
        "resolved_at TIMESTAMP"
        ")"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_showtimereport_showtime_id "
        "ON showtimereport (showtime_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_showtimereport_reporter_id "
        "ON showtimereport (reporter_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_showtimereport_status "
        "ON showtimereport (status)"
    )


def downgrade():
    op.execute("DROP INDEX IF EXISTS ix_showtimereport_status")
    op.execute("DROP INDEX IF EXISTS ix_showtimereport_reporter_id")
    op.execute("DROP INDEX IF EXISTS ix_showtimereport_showtime_id")
    op.execute("DROP TABLE IF EXISTS showtimereport")

    op.execute("DROP INDEX IF EXISTS ix_analyticsevent_created_at")
    op.execute("DROP INDEX IF EXISTS ix_analyticsevent_name")
    op.execute("DROP INDEX IF EXISTS ix_analyticsevent_user_id")
    op.execute("DROP TABLE IF EXISTS analyticsevent")
