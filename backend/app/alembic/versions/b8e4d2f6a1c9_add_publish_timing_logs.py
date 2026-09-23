"""Add listingfirstseen and cinevilleevent

Publish-timing logs: when each source first listed each screening, and the raw
Cineville event feed with Cineville's own created/updated times. Neither has a
foreign key to showtime, so both outlive the screenings they describe.

Forward DDL is idempotent so a replayed run can't wedge the backend.

Revision ID: b8e4d2f6a1c9
Revises: a6c3e8f1d2b4
Create Date: 2026-09-23 00:00:00.000000
"""

from alembic import op

revision = "b8e4d2f6a1c9"
down_revision = "a6c3e8f1d2b4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS listingfirstseen (
            id SERIAL PRIMARY KEY,
            source_stream VARCHAR NOT NULL,
            source_event_key VARCHAR NOT NULL,
            cinema_id INTEGER NOT NULL,
            movie_id INTEGER NOT NULL,
            showtime_datetime TIMESTAMP WITHOUT TIME ZONE NOT NULL,
            first_seen_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
            window_start TIMESTAMP WITHOUT TIME ZONE NOT NULL,
            source_created_at TIMESTAMP WITHOUT TIME ZONE,
            CONSTRAINT uq_listingfirstseen_stream_key
                UNIQUE (source_stream, source_event_key)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_listingfirstseen_source_stream "
        "ON listingfirstseen (source_stream)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_listingfirstseen_cinema_id "
        "ON listingfirstseen (cinema_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_listingfirstseen_first_seen_at "
        "ON listingfirstseen (first_seen_at)"
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS cinevilleevent (
            id VARCHAR PRIMARY KEY,
            venue_id VARCHAR NOT NULL,
            venue_name VARCHAR NOT NULL,
            cinema_id INTEGER,
            production_id VARCHAR,
            title VARCHAR,
            start_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
            is_hidden BOOLEAN NOT NULL DEFAULT false,
            source_created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
            source_updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
            first_seen_at TIMESTAMP WITHOUT TIME ZONE,
            last_seen_at TIMESTAMP WITHOUT TIME ZONE,
            gone_at TIMESTAMP WITHOUT TIME ZONE
        )
        """
    )
    for column in ("venue_id", "cinema_id", "start_at", "source_created_at"):
        op.execute(
            f"CREATE INDEX IF NOT EXISTS ix_cinevilleevent_{column} "
            f"ON cinevilleevent ({column})"
        )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS cinevilleevent")
    op.execute("DROP TABLE IF EXISTS listingfirstseen")
