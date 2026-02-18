from abc import ABC, abstractmethod


class BaseCinemaScraper(ABC):
    @abstractmethod
    def scrape(self) -> list[tuple[str, int]]:
        pass
