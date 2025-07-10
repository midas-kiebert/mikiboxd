from app.scraping.cinemas.generic import GenericEagerlyScraper

class SlachtstraatScraper(GenericEagerlyScraper):
    def __init__(self):
        super().__init__(cinema="Slachtstraat", url_base="https://slachtstraat.nl/")