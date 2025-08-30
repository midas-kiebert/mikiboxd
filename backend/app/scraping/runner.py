import sys

from app.scraping.logger import logger
from app.scraping.scrape import run_cinema_scrapers, scrape_cineville


def run() -> None:
    try:
        logger.info("Starting cineville scraper...")
        scrape_cineville()
        logger.info("Cineville scraper finished successfully.")
        logger.info("Starting cinema scrapers...")
        run_cinema_scrapers()
        logger.info("Ran all cinema scrapers.")

    except Exception:
        logger.error("Error running cinema scraper", exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    run()
