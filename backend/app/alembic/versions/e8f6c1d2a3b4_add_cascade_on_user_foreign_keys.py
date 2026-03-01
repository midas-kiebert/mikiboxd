"""add cascade on user foreign keys

Revision ID: e8f6c1d2a3b4
Revises: d1ab3f26c4e8
Create Date: 2026-03-01 12:40:00.000000
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "e8f6c1d2a3b4"
down_revision = "d1ab3f26c4e8"
branch_labels = None
depends_on = None


def _replace_user_fk(table_name: str, local_columns: list[str], ondelete: str | None):
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    fk_name = None
    for fk in inspector.get_foreign_keys(table_name):
        if fk.get("referred_table") != "user":
            continue
        if fk.get("constrained_columns") != local_columns:
            continue
        fk_name = fk.get("name")
        break

    if fk_name is None:
        raise RuntimeError(
            f"Could not find user FK on {table_name}({', '.join(local_columns)})"
        )

    op.drop_constraint(fk_name, table_name, type_="foreignkey")
    kwargs = {"ondelete": ondelete} if ondelete is not None else {}
    op.create_foreign_key(
        fk_name,
        table_name,
        "user",
        local_columns,
        ["id"],
        **kwargs,
    )


def upgrade():
    _replace_user_fk("cinemaselection", ["user_id"], "CASCADE")
    _replace_user_fk("showtimeselection", ["user_id"], "CASCADE")
    _replace_user_fk("friendship", ["user_id"], "CASCADE")
    _replace_user_fk("friendship", ["friend_id"], "CASCADE")
    _replace_user_fk("friendrequest", ["sender_id"], "CASCADE")
    _replace_user_fk("friendrequest", ["receiver_id"], "CASCADE")
    _replace_user_fk("pushtoken", ["user_id"], "CASCADE")


def downgrade():
    _replace_user_fk("cinemaselection", ["user_id"], None)
    _replace_user_fk("showtimeselection", ["user_id"], None)
    _replace_user_fk("friendship", ["user_id"], None)
    _replace_user_fk("friendship", ["friend_id"], None)
    _replace_user_fk("friendrequest", ["sender_id"], None)
    _replace_user_fk("friendrequest", ["receiver_id"], None)
    _replace_user_fk("pushtoken", ["user_id"], None)
