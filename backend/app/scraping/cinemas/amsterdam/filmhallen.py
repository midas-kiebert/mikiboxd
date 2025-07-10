from app.scraping.cinemas.generic import GenericEagerlyScraper

class FilmHallenScraper(GenericEagerlyScraper):
    def __init__(self):
        super().__init__(cinema="FilmHallen", url_base="https://filmhallen.nl/")