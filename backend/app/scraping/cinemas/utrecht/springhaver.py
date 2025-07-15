from app.scraping.cinemas.generic import GenericEagerlyScraper


class SpringhaverScraper(GenericEagerlyScraper):
    def __init__(self) -> None:
        super().__init__(cinema="Springhaver", url_base="https://springhaver.nl/")
