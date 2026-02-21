from logging import getLogger
from zoneinfo import ZoneInfo

from apscheduler.schedulers.background import (  # type: ignore[import-untyped]
    BlockingScheduler,
)
from apscheduler.triggers.cron import CronTrigger  # type: ignore[import-untyped]

logger = getLogger(__name__)


def scrape_data():
    from app.scraping.runner import run

    run()


def send_interested_showtime_reminders():
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


if __name__ == "__main__":
    scheduler = BlockingScheduler()
    scheduler.add_job(
        func=scrape_data,
        trigger=CronTrigger(hour=3, minute=0, timezone=ZoneInfo("Europe/Amsterdam")),
        id="nightly_scrape",
    )
    scheduler.add_job(
        func=send_interested_showtime_reminders,
        trigger=CronTrigger(minute="*/15", timezone=ZoneInfo("Europe/Amsterdam")),
        id="interested_showtime_reminders",
    )
    scheduler.start()
