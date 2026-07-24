"""add deletedshowtime table

All forward DDL is idempotent so a partial/replayed run on staging cannot
wedge the backend.

Revision ID: 627a211425b7
Revises: a2b3c4d5e6f7
Create Date: 2026-07-24 00:00:00.000000

"""

from alembic import op

revision = "627a211425b7"
down_revision = "a2b3c4d5e6f7"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "CREATE TABLE IF NOT EXISTS deletedshowtime ("
        "id SERIAL NOT NULL PRIMARY KEY, "
        "movie_id integer NOT NULL REFERENCES movie(id) ON DELETE CASCADE, "
        "cinema_id integer NOT NULL REFERENCES cinema(id) ON DELETE CASCADE, "
        "datetime TIMESTAMP NOT NULL, "
        "deleted_at TIMESTAMP NOT NULL, "
        "CONSTRAINT uq_deletedshowtime_unique_fields "
        "UNIQUE (cinema_id, datetime, movie_id)"
        ")"
    )


def downgrade():
    op.execute("DROP TABLE IF EXISTS deletedshowtime")
