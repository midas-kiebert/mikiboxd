from app.scraping.cinemas.generic import GenericEagerlyScraper


class FilmkoepelScraper(GenericEagerlyScraper):
    def __init__(self) -> None:
        super().__init__(cinema="Filmkoepel", url_base="https://filmkoepel.nl/")
