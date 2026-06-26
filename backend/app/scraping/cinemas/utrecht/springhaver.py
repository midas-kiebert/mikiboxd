from app.scraping.cinemas.generic.eagerly import GenericEagerlyScraper


class SpringhaverScraper(GenericEagerlyScraper):
    def __init__(self) -> None:
        super().__init__(cinema="Springhaver", url_base="https://www.springhaver.nl/")
