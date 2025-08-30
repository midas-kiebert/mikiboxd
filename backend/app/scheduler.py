from apscheduler.schedulers.background import (  # type: ignore[import-untyped]
    BlockingScheduler,
)
from apscheduler.triggers.cron import CronTrigger  # type: ignore[import-untyped]


def scrape_data():
    from app.scraping.runner import run

    run()


if __name__ == "__main__":
    scheduler = BlockingScheduler()
    scheduler.add_job(
        func=scrape_data,
        trigger=CronTrigger(hour=23, minute=30),
        id="nightly_scrape",
    )
    scheduler.start()
