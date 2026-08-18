from app.scraping.cinemas.generic.eagerly import GenericEagerlyScraper


class SlachtstraatScraper(GenericEagerlyScraper):
    def __init__(self) -> None:
        super().__init__(
            cinema_key="slachtstraat", url_base="https://www.slachtstraat.nl/"
        )
