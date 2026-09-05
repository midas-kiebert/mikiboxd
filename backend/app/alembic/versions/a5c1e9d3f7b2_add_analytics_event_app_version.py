"""Add analyticsevent.app_version

The dashboard already breaks opens down by platform via `X-Client-Platform`,
but a native platform can span many installed builds at once (App Store /
Play review lag means old and new versions run side by side). This adds the
same treatment for `X-Client-Version`, which mobile already sends on every
request — the web frontend never sets that header, so the column is simply
null there rather than a stale/misleading value.

Forward DDL is idempotent so a partial/replayed run cannot wedge the backend.

Revision ID: a5c1e9d3f7b2
Revises: d2f6b8a4c1e9
Create Date: 2026-09-05 00:00:00.000000
"""

from alembic import op

revision = "a5c1e9d3f7b2"
down_revision = "d2f6b8a4c1e9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE analyticsevent ADD COLUMN IF NOT EXISTS "
        "app_version VARCHAR(32)"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE analyticsevent DROP COLUMN IF EXISTS app_version")
