# from app.logging_ import setup_logger
# logger = setup_logger("cinema_scraper")
from logging import getLogger

from .base_cinema_scraper import BaseCinemaScraper
from .load_letterboxd_slugs import load_letterboxd_slugs

logger = getLogger("cinema_scraper")


__all__ = ["load_letterboxd_slugs", "logger", "BaseCinemaScraper"]
