"""Shared cooldown bookkeeping for the two Letterboxd sync services.

Both the watchlist and the watched sync are user-triggered (the mobile app
fires them on every foreground) and both scrape Letterboxd, which rate-limits
this host hard. The cooldown below is what keeps that traffic bounded, so it
has to be checked *before* the scrape and it has to count failed attempts:
a sync that never completes leaves its success timestamp NULL, and without an
attempt timestamp such a user would re-scrape on every single foreground —
exactly the users Letterboxd is already throttling.
"""

from datetime import datetime, timedelta

from app.utils import now_amsterdam_naive

# Minimum spacing between two syncs of the same kind for one user, counted from
# the last attempt (successful or not).
SYNC_COOLDOWN = timedelta(minutes=10)


def is_within_cooldown(
    *,
    last_sync: datetime | None,
    last_attempt: datetime | None,
) -> bool:
    """Return whether a sync was last tried too recently to try again.

    Both timestamps are naive Amsterdam local time (see `now_amsterdam_naive`);
    comparing them against `datetime.utcnow()` would shift the window by the
    UTC offset, so the current time must come from the same helper that wrote
    them.
    """
    candidates = [stamp for stamp in (last_sync, last_attempt) if stamp is not None]
    if not candidates:
        return False
    return now_amsterdam_naive() - max(candidates) < SYNC_COOLDOWN
