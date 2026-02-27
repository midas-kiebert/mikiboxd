"""add showtime end datetime and subtitles

Revision ID: c3d4e5f6a7b8
Revises: b1c2d3e4f567
Create Date: 2026-02-25 21:50:00.000000

"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "c3d4e5f6a7b8"
down_revision = "b1c2d3e4f567"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("showtime", sa.Column("end_datetime", sa.DateTime(), nullable=True))
    op.add_column(
        "showtime",
        sa.Column("subtitles", sa.ARRAY(sa.String()), nullable=True),
    )


def downgrade():
    op.drop_column("showtime", "subtitles")
    op.drop_column("showtime", "end_datetime")
