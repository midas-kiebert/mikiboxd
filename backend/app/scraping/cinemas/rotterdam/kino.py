from app.scraping.cinemas.generic import GenericEagerlyScraper

class KinoScraper(GenericEagerlyScraper):
    def __init__(self):
        super().__init__(cinema="Kino", url_base="https://kinorotterdam.nl/")