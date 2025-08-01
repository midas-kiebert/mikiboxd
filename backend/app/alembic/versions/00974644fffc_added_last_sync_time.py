"""added last sync time

Revision ID: 00974644fffc
Revises: 52c75363d859
Create Date: 2025-07-26 14:43:10.932041

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel.sql.sqltypes


# revision identifiers, used by Alembic.
revision = '00974644fffc'
down_revision = '52c75363d859'
branch_labels = None
depends_on = None


def upgrade():
    # ### commands auto generated by Alembic - please adjust! ###
    op.add_column('user', sa.Column('last_watchlist_sync', sa.DateTime(), nullable=True))
    # ### end Alembic commands ###


def downgrade():
    # ### commands auto generated by Alembic - please adjust! ###
    op.drop_column('user', 'last_watchlist_sync')
    # ### end Alembic commands ###
