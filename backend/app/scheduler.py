from zoneinfo import ZoneInfo

from apscheduler.schedulers.background import (  # type: ignore[import-untyped]
    BackgroundScheduler,
)
from apscheduler.triggers.cron import CronTrigger  # type: ignore[import-untyped]

scheduler = BackgroundScheduler()


def scrape_data():
    from app.scraping.runner import run

    run()


scheduler.add_job(
    func=scrape_data,
    trigger=CronTrigger(hour=10, minute=37, timezone=ZoneInfo("Europe/Amsterdam")),
    id="nightly_scrape",
)
