from app.scraping.cinemas.generic import GenericEagerlyScraper

class TrianonScraper(GenericEagerlyScraper):
    def __init__(self):
        super().__init__(cinema="Trianon", url_base="https://bioscopenleiden.nl/", theatre_filter="Trianon")