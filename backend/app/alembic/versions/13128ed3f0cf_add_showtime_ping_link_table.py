"""add showtimepinglink table

Shared invite links used to embed a signed JWT as the URL's last segment,
proving which user actually shared the link. That token was long enough
(~200 chars) that WhatsApp/iMessage stopped generating a rich preview for
the message and printed the raw URL instead — a real regression from the
short-UUID links used before the JWT was introduced.

This table replaces the self-contained signed token with a short random
code looked up server-side: `create_showtime_ping_link_token` mints a code
and stores (code, showtime_id, sender_id) here; `receive_ping_from_link`
looks the code up instead of decoding it. Same unforgeability guarantee
(the code isn't guessable), much shorter URL, and short codes leave room
for a future QR code.

Forward DDL is idempotent so a partial/replayed run cannot wedge the backend.

Revision ID: 13128ed3f0cf
Revises: e2f3a4b5c6d7
Create Date: 2026-08-19 00:00:00.000000
"""

from alembic import op

revision = "13128ed3f0cf"
down_revision = "e2f3a4b5c6d7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "CREATE TABLE IF NOT EXISTS showtimepinglink ("
        "token VARCHAR(32) NOT NULL PRIMARY KEY, "
        "showtime_id INTEGER NOT NULL REFERENCES showtime(id) ON DELETE CASCADE, "
        'sender_id UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, '
        "created_at TIMESTAMP NOT NULL"
        ")"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_showtimepinglink_showtime_id "
        "ON showtimepinglink (showtime_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_showtimepinglink_sender_id "
        "ON showtimepinglink (sender_id)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_showtimepinglink_sender_id")
    op.execute("DROP INDEX IF EXISTS ix_showtimepinglink_showtime_id")
    op.execute("DROP TABLE IF EXISTS showtimepinglink")
