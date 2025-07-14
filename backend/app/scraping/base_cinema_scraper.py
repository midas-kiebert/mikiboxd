from abc import ABC, abstractmethod

class BaseCinemaScraper(ABC):
    @abstractmethod
    def scrape(self) -> None:
        pass