import sys

import yaml

from app.scraping import load_letterboxd_slugs, logger

from . import BaseCinemaScraper
from .cinemas import SCRAPER_REGISTRY


# @logger.catch(message="Error running cinema scraper", reraise=True)
def run() -> None:
    with open("app/configs/cinemas.yaml") as f:
        cinemas = yaml.safe_load(f)
    # logger.trace(f"Loaded cinema config for {len(cinemas['cinemas'])} cinemas")

    for cinema, setting in cinemas["cinemas"].items():
        if not setting.get("enabled"):
            logger.debug(f"Skipping disabled cinema scraper: {cinema}")
            continue
        scraper_cls = SCRAPER_REGISTRY.get(cinema)
        if not scraper_cls:
            # logger.trace("Scraper class not found")
            continue
        scraper: BaseCinemaScraper = scraper_cls()

        logger.info(f"Running scraper for cinema: {cinema}...")
        # with logger.catch(message=f"Error running cinema scraper for {cinema}"):
        scraper.scrape()
        # logger.success(f"Scraped showtime data for cinema: {cinema}.")
    logger.info("Loading Letterboxd slugs...")
    load_letterboxd_slugs()
    # logger.success("Successfully loaded Letterboxd slugs.")


if __name__ == "__main__":
    try:
        run()
    except Exception:
        sys.exit(1)
