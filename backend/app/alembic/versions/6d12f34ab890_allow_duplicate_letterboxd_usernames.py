"""allow duplicate letterboxd usernames

Revision ID: 6d12f34ab890
Revises: f4a8c2d91b7e
Create Date: 2026-02-21 00:00:01.000000

"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "6d12f34ab890"
down_revision = "f4a8c2d91b7e"
branch_labels = None
depends_on = None


def upgrade():
    op.drop_index(op.f("ix_user_letterboxd_username"), table_name="user")
    op.create_index(
        op.f("ix_user_letterboxd_username"),
        "user",
        ["letterboxd_username"],
        unique=False,
    )


def downgrade():
    op.drop_index(op.f("ix_user_letterboxd_username"), table_name="user")
    op.create_index(
        op.f("ix_user_letterboxd_username"),
        "user",
        ["letterboxd_username"],
        unique=True,
    )
