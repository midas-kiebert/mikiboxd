"""Background job scheduler.

Runs as a standalone blocking process (separate from the API server) and
executes periodic tasks via APScheduler cron triggers.

Usage:
    uv run python -m app.scheduler
"""

import logging
from logging import getLogger
from zoneinfo import ZoneInfo

from apscheduler.schedulers.background import (  # type: ignore[import-untyped]
    BlockingScheduler,
)
from apscheduler.triggers.cron import CronTrigger  # type: ignore[import-untyped]

logging.basicConfig(level=logging.INFO)
logger = getLogger(__name__)

_TIMEZONE = ZoneInfo("Europe/Amsterdam")


def _scrape_data() -> None:
    """Run the nightly scrape — fetches showtimes for all cinemas and syncs them to the DB."""
    from app.scraping.runner import run

    try:
        run()
    except Exception:
        logger.exception("Failed to run nightly scrape job")


def _send_interested_showtime_reminders() -> None:
    """Send push notifications for showtimes the user marked as interested in.

    Runs every 15 minutes. Only logs when at least one notification was sent.
    Errors are caught so a single failure does not stop the scheduler.
    """
    from app.api.deps import get_db_context
    from app.services import push_notifications

    try:
        with get_db_context() as session:
            sent_count = push_notifications.send_interested_showtime_reminders(
                session=session,
            )
        if sent_count > 0:
            logger.info("Sent %s interested-showtime reminders", sent_count)
    except Exception:
        logger.exception("Failed to run interested-showtime reminder job")


def _purge_stale_notifications() -> None:
    """Decay notification-centre entries (dismissed or older than the max age).

    Runs daily. Only logs when at least one row was removed. Errors are caught so
    a single failure does not stop the scheduler.
    """
    from app.api.deps import get_db_context
    from app.services import me as me_service

    try:
        with get_db_context() as session:
            deleted_count = me_service.purge_stale_notifications(session=session)
        if deleted_count > 0:
            logger.info("Purged %s stale notifications", deleted_count)
    except Exception:
        logger.exception("Failed to run notification purge job")


if __name__ == "__main__":
    scheduler = BlockingScheduler()
    scheduler.add_job(
        func=_scrape_data,
        trigger=CronTrigger(hour=3, minute=0, timezone=_TIMEZONE),
        id="nightly_scrape",
    )
    scheduler.add_job(
        func=_send_interested_showtime_reminders,
        trigger=CronTrigger(minute="*/15", timezone=_TIMEZONE),
        id="interested_showtime_reminders",
    )
    scheduler.add_job(
        func=_purge_stale_notifications,
        trigger=CronTrigger(hour=4, minute=0, timezone=_TIMEZONE),
        id="purge_stale_notifications",
    )
    scheduler.start()
