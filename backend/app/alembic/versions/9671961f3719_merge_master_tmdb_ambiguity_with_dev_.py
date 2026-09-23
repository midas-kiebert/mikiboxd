"""Merge master's TMDB ambiguity migration with dev's Letterboxd avatar ones

Both branch off a5c1e9d3f7b2: master shipped d3a7c1e5b9f2 to production
(PR #325) while dev added b8d4f1a6c3e9 -> c4e8a2f6b1d3. Staging reseeds from
production's database, so it arrives at d3a7c1e5b9f2 and needs this merge
point to reach dev's head. No schema of its own.

Revision ID: 9671961f3719
Revises: c4e8a2f6b1d3, d3a7c1e5b9f2
Create Date: 2026-09-23 17:19:20.805841
"""

revision = "9671961f3719"
down_revision = ("c4e8a2f6b1d3", "d3a7c1e5b9f2")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
