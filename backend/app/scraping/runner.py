import sys

from app.scraping.logger import logger
from app.scraping.scrape import scrape_cineville


def run() -> None:
    try:
        logger.info("Starting cineville scraper...")
        scrape_cineville()
        logger.info("Cineville scraper finished successfully.")
    except Exception:
        logger.error("Error running cinema scraper", exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    run()
