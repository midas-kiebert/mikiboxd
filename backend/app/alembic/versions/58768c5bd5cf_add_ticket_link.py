"""add ticket_link

Revision ID: 58768c5bd5cf
Revises: a894bfa5f066
Create Date: 2025-07-01 17:50:12.847183

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel.sql.sqltypes


# revision identifiers, used by Alembic.
revision = '58768c5bd5cf'
down_revision = 'a894bfa5f066'
branch_labels = None
depends_on = None


def upgrade():
    # ### commands auto generated by Alembic - please adjust! ###
    op.create_table('friendrequest',
    sa.Column('sender_id', sa.Uuid(), nullable=False),
    sa.Column('receiver_id', sa.Uuid(), nullable=False),
    sa.Column('status', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.ForeignKeyConstraint(['receiver_id'], ['user.id'], ),
    sa.ForeignKeyConstraint(['sender_id'], ['user.id'], ),
    sa.PrimaryKeyConstraint('sender_id', 'receiver_id')
    )
    op.create_table('friendship',
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('friend_id', sa.Uuid(), nullable=False),
    sa.ForeignKeyConstraint(['friend_id'], ['user.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['user.id'], ),
    sa.PrimaryKeyConstraint('user_id', 'friend_id')
    )
    # ### end Alembic commands ###


def downgrade():
    # ### commands auto generated by Alembic - please adjust! ###
    op.drop_table('friendship')
    op.drop_table('friendrequest')
    # ### end Alembic commands ###
