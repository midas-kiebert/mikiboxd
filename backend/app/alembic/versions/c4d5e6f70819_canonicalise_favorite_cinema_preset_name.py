"""Canonicalise the auto-generated favorite cinema preset name.

Three iterations of the app created the user's startup cinema selection for
them under three different names: "Preferred" (the legacy web endpoint) and
"Favorite Cinemas" (the intro). None of them were chosen by the user, and the
UI now presents that row as one named thing, so they are folded into a single
canonical name. The favorite is still identified by `is_favorite`, never by
this name — a user who renames it stays on the same row.

Revision ID: c4d5e6f70819
Revises: b7e4c1a9d6f2
Create Date: 2026-08-18 00:00:00.000000

"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "c4d5e6f70819"
down_revision = "b7e4c1a9d6f2"
branch_labels = None
depends_on = None

CANONICAL_NAME = "My Cinemas"
GENERATED_NAMES = ("Preferred", "Favorite Cinemas")


def upgrade():
    # Skips any user who already has a preset under the canonical name: preset
    # names are unique per user, so renaming into one would hit the constraint
    # and take a preset they did name themselves with it.
    op.execute(
        f"""
        UPDATE cinemapreset AS preset
        SET name = '{CANONICAL_NAME}'
        WHERE preset.is_favorite IS TRUE
          AND preset.name IN {GENERATED_NAMES!r}
          AND NOT EXISTS (
              SELECT 1
              FROM cinemapreset AS other
              WHERE other.owner_user_id = preset.owner_user_id
                AND other.id <> preset.id
                AND other.name = '{CANONICAL_NAME}'
          )
        """
    )


def downgrade():
    # One-way: the three original names are indistinguishable afterwards, and
    # the name carries no behaviour, so there is nothing to restore.
    pass
