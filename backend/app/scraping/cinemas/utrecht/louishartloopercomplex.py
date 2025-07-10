from app.scraping.cinemas.generic import GenericEagerlyScraper

class LouisHartlooperComplexScraper(GenericEagerlyScraper):
    def __init__(self):
        super().__init__(cinema="Louis Hartlooper Complex", url_base="https://hartlooper.nl/")