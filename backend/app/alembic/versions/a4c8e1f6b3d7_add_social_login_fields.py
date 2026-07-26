"""Add social sign-in fields (nullable password, apple_sub, google_sub).

Revision ID: a4c8e1f6b3d7
Revises: 36c9362fc3c0
Create Date: 2026-07-26 00:00:00.000000

"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "a4c8e1f6b3d7"
down_revision = "36c9362fc3c0"
branch_labels = None
depends_on = None


def upgrade():
    op.execute('ALTER TABLE "user" ALTER COLUMN hashed_password DROP NOT NULL')
    op.execute('ALTER TABLE "user" ADD COLUMN IF NOT EXISTS apple_sub VARCHAR')
    op.execute('ALTER TABLE "user" ADD COLUMN IF NOT EXISTS google_sub VARCHAR')
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_user_apple_sub "
        'ON "user" (apple_sub)'
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_user_google_sub "
        'ON "user" (google_sub)'
    )


def downgrade():
    op.execute("DROP INDEX IF EXISTS ix_user_google_sub")
    op.execute("DROP INDEX IF EXISTS ix_user_apple_sub")
    op.execute('ALTER TABLE "user" DROP COLUMN IF EXISTS google_sub')
    op.execute('ALTER TABLE "user" DROP COLUMN IF EXISTS apple_sub')
    op.execute('ALTER TABLE "user" ALTER COLUMN hashed_password SET NOT NULL')
