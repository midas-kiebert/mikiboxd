"""Add user.email_verified, trusting every account that already exists

Registration never asked anyone to prove they own the address they typed, which
is what made "Continue with Google" risky in one specific direction: the
provider proves the address, but the account being linked *into* was created on
an unproven claim, so an address registered by someone else was a way into the
real owner's sign-in. Confirming the address at signup is the root fix.

Every account already in the database is marked verified: they are the trusted
testers from before this existed, and re-confirming them would lock them out of
nothing while asking them to prove something nobody ever doubted. Only accounts
created after this migration start unverified.

Backfilled with a bare `UPDATE`, deliberately unqualified — it runs once, before
any account can have been created under the new rule, so "every row" and "every
pre-existing account" are the same set.

Forward DDL is idempotent so a partial/replayed run cannot wedge the backend.
Note that the backfill is idempotent only in the sense that re-running it is
harmless *at this revision*; alembic will not run it again once stamped.

Revision ID: e1c9d3a7f2b4
Revises: d4a8e2c6f1b9
Create Date: 2026-07-29 17:05:00.000000
"""

from alembic import op

revision = "e1c9d3a7f2b4"
down_revision = "d4a8e2c6f1b9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        'ALTER TABLE "user" '
        "ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false"
    )
    # Grandfather the existing accounts. New rows keep the column default.
    op.execute('UPDATE "user" SET email_verified = true WHERE email_verified = false')


def downgrade() -> None:
    op.execute('ALTER TABLE "user" DROP COLUMN IF EXISTS email_verified')
