"""Seat availability phase 2: cadence, level floor, room capacity, pro flag, watches

`showtime.seats_next_check_at` moves the polling cadence out of the query and
onto the row: how full a screening is and how soon it starts decide when it is
next worth reading, and that decision is written down once rather than
re-derived on every run. It starts NULL, which the poller reads as "never
read, read it next" — the same value the interest trigger writes.

`showtime.seats_unchanged_streak` counts consecutive identical readings so a
showtime nothing is happening to backs off.

`user.is_pro` gates features whose cost is per-user rather than per-request;
right now only the sold-out watch. Who has it is seeded per environment in
core/db.py, not here.

`soldoutwatch` is one user waiting on one showtime for a returned ticket. The
unique `user_id` is the "one watch at a time" rule.

`showtime.seats_level_floor` is the fullest busyness level a screening has ever
reached, and its displayed level never drops below it — capacity only ever
grows, and a growing denominator would otherwise make a screening appear to
empty out as we learned more about it.

`showtimeselection.seat_alert_sent_at` is the once-per-showtime guarantee for
the "nearly sold out" notice.

`cinemaroomcapacity` shares one capacity estimate across every screening in a
room, which is the only way it converges: a single showtime is read a handful
of times, a busy room hundreds of times a week. Seeded from the per-showtime
maxima already on `showtime`.

Forward DDL is idempotent so a partial/replayed run cannot wedge the backend.

Revision ID: c3f1a90d4e77
Revises: b7c8d9e0f1a2
Create Date: 2026-08-24 22:10:00.000000
"""

from alembic import op

revision = "c3f1a90d4e77"
down_revision = "b7c8d9e0f1a2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE showtime ADD COLUMN IF NOT EXISTS seats_next_check_at TIMESTAMP"
    )
    op.execute(
        "ALTER TABLE showtime "
        "ADD COLUMN IF NOT EXISTS seats_unchanged_streak INTEGER NOT NULL DEFAULT 0"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_showtime_seats_next_check_at "
        "ON showtime (seats_next_check_at)"
    )
    op.execute(
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS is_pro BOOLEAN NOT NULL DEFAULT FALSE'
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS soldoutwatch (
            id SERIAL PRIMARY KEY,
            user_id UUID NOT NULL UNIQUE REFERENCES "user" (id) ON DELETE CASCADE,
            showtime_id INTEGER NOT NULL REFERENCES showtime (id) ON DELETE CASCADE,
            created_at TIMESTAMP NOT NULL,
            next_check_at TIMESTAMP NOT NULL,
            last_checked_at TIMESTAMP,
            checks_done INTEGER NOT NULL
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_soldoutwatch_showtime_id "
        "ON soldoutwatch (showtime_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_soldoutwatch_next_check_at "
        "ON soldoutwatch (next_check_at)"
    )
    op.execute(
        "ALTER TABLE showtime ADD COLUMN IF NOT EXISTS seats_level_floor VARCHAR(40)"
    )
    op.execute(
        "ALTER TABLE showtimeselection "
        "ADD COLUMN IF NOT EXISTS seat_alert_sent_at TIMESTAMP"
    )
    op.execute(
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS '
        "notify_on_seat_alert BOOLEAN NOT NULL DEFAULT TRUE"
    )
    # 'PUSH'/'EMAIL', not 'push'/'email': the notify_channel_* columns store the
    # NotificationChannel enum's member *name*, not its value, because the field
    # has no `values_callable` (see bc34de56fa78, which fixed this exact mistake
    # for the four earlier notify_channel_* columns after it broke a broad
    # `select(User)` the same way).
    op.execute(
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS '
        "notify_channel_seat_alert VARCHAR(16) NOT NULL DEFAULT 'PUSH'"
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS cinemaroomcapacity (
            cinema_id INTEGER NOT NULL REFERENCES cinema (id) ON DELETE CASCADE,
            room VARCHAR(255) NOT NULL,
            seats_capacity INTEGER NOT NULL,
            updated_at TIMESTAMP NOT NULL,
            PRIMARY KEY (cinema_id, room)
        )
        """
    )
    # Seed each room from what its screenings have already taught us, so the
    # shared estimate starts where the per-showtime ones left off instead of
    # from nothing. Idempotent: re-running only ever raises a row.
    op.execute(
        """
        INSERT INTO cinemaroomcapacity (cinema_id, room, seats_capacity, updated_at)
        SELECT cinema_id, room, MAX(seats_capacity), NOW()
        FROM showtime
        WHERE room IS NOT NULL AND seats_capacity IS NOT NULL
        GROUP BY cinema_id, room
        ON CONFLICT (cinema_id, room) DO UPDATE
        SET seats_capacity = GREATEST(
                cinemaroomcapacity.seats_capacity, EXCLUDED.seats_capacity
            ),
            updated_at = NOW()
        """
    )
    # Existing rows have a reading but no cadence yet. Leaving the due time NULL
    # would make every already-polled showtime due at once on the next run; the
    # per-run caps would hold, but there is no reason to re-read a count that is
    # minutes old. Starting them an hour after their last reading spreads the
    # catch-up out and matches what the cadence would have chosen anyway.
    op.execute(
        "UPDATE showtime SET seats_next_check_at = seats_checked_at + INTERVAL '1 hour' "
        "WHERE seats_checked_at IS NOT NULL AND seats_next_check_at IS NULL"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS cinemaroomcapacity")
    op.execute('ALTER TABLE "user" DROP COLUMN IF EXISTS notify_channel_seat_alert')
    op.execute('ALTER TABLE "user" DROP COLUMN IF EXISTS notify_on_seat_alert')
    op.execute("ALTER TABLE showtimeselection DROP COLUMN IF EXISTS seat_alert_sent_at")
    op.execute("ALTER TABLE showtime DROP COLUMN IF EXISTS seats_level_floor")
    op.execute("DROP TABLE IF EXISTS soldoutwatch")
    op.execute('ALTER TABLE "user" DROP COLUMN IF EXISTS is_pro')
    op.execute("DROP INDEX IF EXISTS ix_showtime_seats_next_check_at")
    op.execute("ALTER TABLE showtime DROP COLUMN IF EXISTS seats_unchanged_streak")
    op.execute("ALTER TABLE showtime DROP COLUMN IF EXISTS seats_next_check_at")
