import logging
import sys

logger = logging.getLogger("cinema_scraper")
logger.setLevel(logging.DEBUG)  # Or INFO, WARNING, etc.

if not logger.handlers:  # Prevent adding handlers multiple times
    handler = logging.StreamHandler(sys.stdout)  # Send logs to console
    handler.setLevel(logging.DEBUG)

    formatter = logging.Formatter(
        "[%(asctime)s] [%(levelname)s] %(name)s: %(message)s", "%Y-%m-%d %H:%M:%S"
    )
    handler.setFormatter(formatter)
    logger.addHandler(handler)

logger.propagate = False
