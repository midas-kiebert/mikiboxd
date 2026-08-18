import os
from abc import ABC, abstractmethod


class BaseCinemaScraper(ABC):
    """A scraper for exactly one cinema.

    `cinema_key` is that cinema's key in cinemas.yaml and `cinema_id` the row it
    resolved to. Both are set during construction, so that the runner can report
    which cinema a scraper belongs to without keeping its own mapping.
    """

    cinema_key: str
    cinema_id: int | None

    @staticmethod
    def item_concurrency(default: int = 4) -> int:
        raw = os.getenv("CINEMA_SCRAPER_ITEM_CONCURRENCY")
        if raw is None:
            return default
        try:
            return max(1, int(raw))
        except ValueError:
            return default

    @abstractmethod
    def scrape(self) -> list[tuple[str, int]]:
        pass
