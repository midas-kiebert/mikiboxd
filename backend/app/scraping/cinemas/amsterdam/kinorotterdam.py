from app.scraping.cinemas.generic.eagerly import GenericEagerlyScraper


class KinoRotterdamScraper(GenericEagerlyScraper):
    def __init__(self) -> None:
        super().__init__(cinema="KINO", url_base="https://www.kinorotterdam.nl/")
