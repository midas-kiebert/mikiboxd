from app.logging_ import setup_logger
from .load_letterboxd_slugs import load_letterboxd_slugs
from .base_cinema_scraper import BaseCinemaScraper

logger = setup_logger("cinema_scraper")

__all__ = ["load_letterboxd_slugs",
           "setup_logger",
           "BaseCinemaScraper"]