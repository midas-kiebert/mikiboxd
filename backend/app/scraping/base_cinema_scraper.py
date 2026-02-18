import os
from abc import ABC, abstractmethod


class BaseCinemaScraper(ABC):
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
