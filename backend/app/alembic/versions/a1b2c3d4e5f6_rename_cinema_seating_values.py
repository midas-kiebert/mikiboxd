"""rename cinema seating values to new short form

Revision ID: a1b2c3d4e5f6
Revises: f0b7c3d5e9a1
Create Date: 2026-05-30 14:00:00.000000
"""

from alembic import op

revision = "a1b2c3d4e5f6"
down_revision = "f0b7c3d5e9a1"
branch_labels = None
depends_on = None


_OLD_TO_NEW = {
    "row-number-seat-number": "number-number",
    "row-letter-seat-number": "letter-number",
    "row-number-seat-letter": "number-letter",
    "row-letter-seat-letter": "letter-letter",
}


def upgrade() -> None:
    for old, new in _OLD_TO_NEW.items():
        op.execute(
            f"UPDATE cinema SET seating = '{new}' WHERE seating = '{old}'"
        )


def downgrade() -> None:
    for old, new in _OLD_TO_NEW.items():
        op.execute(
            f"UPDATE cinema SET seating = '{old}' WHERE seating = '{new}'"
        )
