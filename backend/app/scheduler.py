from zoneinfo import ZoneInfo

from apscheduler.schedulers.background import (  # type: ignore[import-untyped]
    BlockingScheduler,
)
from apscheduler.triggers.cron import CronTrigger  # type: ignore[import-untyped]


def scrape_data():
    from app.scraping.runner import run

    print("Starting nightly scrape of cinema data...")
    run()


if __name__ == "__main__":
    scheduler = BlockingScheduler()
    scheduler.add_job(
        func=scrape_data,
        trigger=CronTrigger(hour=13, minute=18, timezone=ZoneInfo("Europe/Amsterdam")),
        id="nightly_scrape",
    )
    scheduler.start()
