"""Recreate missing migration

Revision ID: 5af13ee3d4c0
Revises: 432927b50293
Create Date: 2025-06-29 23:49:28.068714

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel.sql.sqltypes


# revision identifiers, used by Alembic.
revision = '5af13ee3d4c0'
down_revision = '432927b50293'
branch_labels = None
depends_on = None


def upgrade():
    # ### commands auto generated by Alembic - please adjust! ###
    pass
    # ### end Alembic commands ###


def downgrade():
    # ### commands auto generated by Alembic - please adjust! ###
    pass
    # ### end Alembic commands ###
