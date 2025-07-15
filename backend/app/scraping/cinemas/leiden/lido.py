from app.scraping.cinemas.generic import GenericEagerlyScraper


class LidoScraper(GenericEagerlyScraper):
    def __init__(self) -> None:
        super().__init__(
            cinema="Lido", url_base="https://bioscopenleiden.nl/", theatre_filter="Lido"
        )
