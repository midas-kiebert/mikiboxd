from app.scraping.cinemas.generic import GenericEagerlyScraper


class KijkhuisScraper(GenericEagerlyScraper):
    def __init__(self) -> None:
        super().__init__(
            cinema="Kijkhuis",
            url_base="https://bioscopenleiden.nl/",
            theatre_filter="Kijkhuis",
        )
