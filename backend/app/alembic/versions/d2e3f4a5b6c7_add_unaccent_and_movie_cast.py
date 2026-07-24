"""Enable unaccent extension and add movie.cast column.

Search needs diacritics-insensitive matching (Postgres ``unaccent``
extension) and a place to store the cast list scraped from TMDB so search
can match against actor names.

Revision ID: d2e3f4a5b6c7
Revises: c1a2b3d4e5f6
Create Date: 2026-06-21 10:00:00.000000

"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "d2e3f4a5b6c7"
down_revision = "c1a2b3d4e5f6"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("CREATE EXTENSION IF NOT EXISTS unaccent")
    op.execute('ALTER TABLE movie ADD COLUMN IF NOT EXISTS "cast" VARCHAR[]')


def downgrade():
    op.drop_column("movie", "cast")
    op.execute("DROP EXTENSION IF EXISTS unaccent")
