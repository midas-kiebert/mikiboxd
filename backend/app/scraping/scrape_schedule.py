"""When the full scrape runs.

The scheduler ticks `run_if_due` every minute; whether a scrape actually starts
is decided here, from the database, rather than by a cron trigger firing at an
exact second. A cron job that starts even a few seconds late is dropped by
APScheduler (its misfire grace defaults to one second) — that is how the Monday
21 Sep 2026 18:00 run vanished while seat-availability jobs held the scheduler
up — and one that was due while the container was restarting is simply lost.
Here a late or missed slot is caught up by the next tick instead.

The slots follow when cinemas publish. Cineville's own creation times for
53k screenings (27 Jul - 20 Sep 2026) put 81% of new screenings on Monday
between 09:00 and 18:00, a second, smaller moment on Thursday morning (the new
film week; also the day with the most same-day additions), a thin spread over
Tuesday, Wednesday and Friday office hours, next to nothing at weekends and
nothing at night. So Monday is scraped every half hour through office hours,
Thursday every half hour until noon, the other weekdays every two hours, the
weekend four times, and the night not at all. Replayed against those 53k
creation times this halves the runs of a flat hourly schedule (77 a week
against 140) while cutting the Monday wait to a median 17 min and Thursday
morning's to 12 min. The admin publish-timing view is where to check it still
fits.

Each slot starts at a random offset of up to half the gap to the next slot (at
most `SLOT_JITTER`), so runs don't hit the sources at the same minute every
time and the publish-timing log isn't sampled on a fixed grid. The offset is
derived from the slot itself, so a restart doesn't re-roll it.
"""

import os
import random
from datetime import datetime, timedelta

from sqlmodel import col, func, select

from app.api.deps import get_db_context
from app.models.scrape_recap import ScrapeRecap
from app.models.scrape_run import ScrapeRun
from app.scraping.logger import logger
from app.utils import now_amsterdam_naive

SLOT_JITTER = timedelta(minutes=30)
# The jitter bound for a day's last slot, which has no next slot to measure to.
LAST_SLOT_GAP = timedelta(hours=1)


def _every(first: str, last: str, step_minutes: int) -> tuple[timedelta, ...]:
    """Slot times from `first` to `last` inclusive ("HH:MM"), `step_minutes` apart."""

    def parse(clock: str) -> timedelta:
        hours, minutes = clock.split(":")
        return timedelta(hours=int(hours), minutes=int(minutes))

    start, end, step = parse(first), parse(last), timedelta(minutes=step_minutes)
    slots = []
    while start <= end:
        slots.append(start)
        start += step
    return tuple(slots)


MONDAY = (
    *_every("08:00", "08:00", 60),
    *_every("09:00", "17:30", 30),
    *_every("18:00", "23:00", 60),
)
THURSDAY = (*_every("08:00", "11:30", 30), *_every("12:00", "23:00", 60))
QUIET_WEEKDAY = _every("08:00", "22:00", 120)
WEEKEND = _every("10:00", "22:00", 240)

# Slots per weekday (Monday = 0), as offsets from midnight, Amsterdam time.
DEFAULT_WEEKLY_SLOTS: dict[int, tuple[timedelta, ...]] = {
    0: MONDAY,
    1: QUIET_WEEKDAY,
    2: QUIET_WEEKDAY,
    3: THURSDAY,
    4: QUIET_WEEKDAY,
    5: WEEKEND,
    6: WEEKEND,
}


def _weekly_slots_from_env() -> dict[int, tuple[timedelta, ...]]:
    """`SCRAPE_SLOT_HOURS` ("8,14,20") replaces the weekly shape with the same
    hours every day, e.g. so staging doesn't double the load we put on the
    cinemas at prod's cadence."""
    raw = os.getenv("SCRAPE_SLOT_HOURS")
    if not raw:
        return DEFAULT_WEEKLY_SLOTS
    try:
        hours = sorted({int(part) for part in raw.split(",") if part.strip()})
    except ValueError:
        return DEFAULT_WEEKLY_SLOTS
    if not hours or any(hour < 0 or hour > 23 for hour in hours):
        return DEFAULT_WEEKLY_SLOTS
    slots = tuple(timedelta(hours=hour) for hour in hours)
    return dict.fromkeys(range(7), slots)


WEEKLY_SLOTS = _weekly_slots_from_env()

# Set when this process starts a run, so a run that crashes before writing
# anything to the database isn't retried every minute.
_last_started_at: datetime | None = None


def slot_due_at(slot_start: datetime, jitter: timedelta = SLOT_JITTER) -> datetime:
    """When the slot starting at `slot_start` is due: the slot plus its offset."""
    offset = random.Random(slot_start.isoformat()).uniform(0, jitter.total_seconds())
    return slot_start + timedelta(seconds=int(offset))


def due_times(day: datetime) -> list[datetime]:
    """Every slot's due time on the calendar day starting at midnight `day`."""
    slots = WEEKLY_SLOTS[day.weekday()]
    gaps = [
        later - earlier for earlier, later in zip(slots, slots[1:], strict=False)
    ] + [LAST_SLOT_GAP]
    return [
        slot_due_at(day + slot, min(SLOT_JITTER, gap / 2))
        for slot, gap in zip(slots, gaps, strict=True)
    ]


def latest_due_at(now: datetime) -> datetime:
    """The due time of the most recent slot that is already due at `now`."""
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
    for days_back in range(8):
        day = midnight - timedelta(days=days_back)
        past = [due for due in due_times(day) if due <= now]
        if past:
            return max(past)
    raise ValueError("No scrape slot in the past week; WEEKLY_SLOTS is empty")


def _last_run_started_at() -> datetime | None:
    with get_db_context() as session:
        from_runs = session.exec(select(func.max(col(ScrapeRun.started_at)))).one()
        from_recaps = session.exec(select(func.max(col(ScrapeRecap.started_at)))).one()
    stamps = [stamp for stamp in (from_runs, from_recaps, _last_started_at) if stamp]
    return max(stamps, default=None)


def is_due(*, now: datetime, last_started_at: datetime | None) -> bool:
    return last_started_at is None or last_started_at < latest_due_at(now)


def run_if_due() -> bool:
    """Start a full scrape if its slot has come up since the last one started."""
    global _last_started_at
    now = now_amsterdam_naive()
    last_started_at = _last_run_started_at()
    if not is_due(now=now, last_started_at=last_started_at):
        return False
    due_at = latest_due_at(now)
    if now - due_at > timedelta(minutes=5):
        logger.warning("Starting the scrape due at %s %s late.", due_at, now - due_at)
    _last_started_at = now

    from app.scraping.runner import run

    run()
    return True
