from zoneinfo import ZoneInfo

from apscheduler.schedulers.background import (
    BackgroundScheduler,  # type: ignore[import-untyped]
)
from apscheduler.triggers.cron import CronTrigger  # type: ignore[import-untyped]

scheduler = BackgroundScheduler()


def scrape_data():
    from app.scraping.runner import run

    run()


scheduler.add_job(
    func=scrape_data,
    trigger=CronTrigger(hour=23, minute=29, timezone=ZoneInfo("Europe/Amsterdam")),
    id="nightly_scrape",
)
