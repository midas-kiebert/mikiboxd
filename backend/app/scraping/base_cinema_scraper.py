
import os
from abc import ABC, abstractmethod
from collections.abc import Iterable
from datetime import datetime

from app.services import unidentified_listings


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

    def record_unidentified_listing(
        self,
        *,
        title: str,
        datetimes: Iterable[datetime],
    ) -> None:
        """Note the screenings of a film this scraper skipped for want of a match.

        Call it wherever a listed film is dropped because it couldn't be
        identified, with every screening time the site lists for it. A Cineville
        showtime at one of those times is then never removed on this scraper's
        account, and is reported in the scrape recap instead — see
        `app.services.unidentified_listings`.
        """
        if self.cinema_id is None:
            return
        unidentified_listings.record_unidentified_listings(
            cinema_id=self.cinema_id,
            title=title,
            datetimes=datetimes,
        )

    @abstractmethod
    def scrape(self) -> list[tuple[str, int]]:
        pass
