"""store all watchlist movies by slug and add watched movies table

Revision ID: c1d2e3f4a5b6
Revises: b7d2e4f6a8c0
Create Date: 2026-06-11 00:00:00.000000

"""

import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op

# revision identifiers, used by Alembic.
revision = "c1d2e3f4a5b6"
down_revision = "b7d2e4f6a8c0"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "watchlistselection",
        sa.Column(
            "letterboxd_slug", sqlmodel.sql.sqltypes.AutoString(), nullable=True
        ),
    )
    op.execute(
        """
        UPDATE watchlistselection
        SET letterboxd_slug = movie.letterboxd_slug
        FROM movie
        WHERE watchlistselection.movie_id = movie.id
        """
    )
    # Drop any selections we couldn't backfill a slug for (movie missing or
    # without a Letterboxd slug); these will reappear on the next sync.
    op.execute("DELETE FROM watchlistselection WHERE letterboxd_slug IS NULL")

    op.alter_column("watchlistselection", "letterboxd_slug", nullable=False)

    op.drop_constraint(
        "watchlistselection_pkey", "watchlistselection", type_="primary"
    )
    op.alter_column("watchlistselection", "movie_id", nullable=True)
    op.create_primary_key(
        "watchlistselection_pkey",
        "watchlistselection",
        ["letterboxd_username", "letterboxd_slug"],
    )

    op.add_column(
        "letterboxd",
        sa.Column("last_watched_sync", sa.DateTime(), nullable=True),
    )

    op.create_table(
        "watchedselection",
        sa.Column(
            "letterboxd_username", sqlmodel.sql.sqltypes.AutoString(), nullable=False
        ),
        sa.Column(
            "letterboxd_slug", sqlmodel.sql.sqltypes.AutoString(), nullable=False
        ),
        sa.Column("movie_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(
            ["letterboxd_username"], ["letterboxd.letterboxd_username"]
        ),
        sa.ForeignKeyConstraint(["movie_id"], ["movie.id"]),
        sa.PrimaryKeyConstraint("letterboxd_username", "letterboxd_slug"),
    )


def downgrade():
    op.drop_table("watchedselection")
    op.drop_column("letterboxd", "last_watched_sync")

    op.execute("DELETE FROM watchlistselection WHERE movie_id IS NULL")

    op.drop_constraint(
        "watchlistselection_pkey", "watchlistselection", type_="primary"
    )
    op.alter_column("watchlistselection", "movie_id", nullable=False)
    op.create_primary_key(
        "watchlistselection_pkey",
        "watchlistselection",
        ["letterboxd_username", "movie_id"],
    )
    op.drop_column("watchlistselection", "letterboxd_slug")
