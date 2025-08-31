from app.scraping.cinemas.generic.eagerly import GenericEagerlyScraper


class FilmHallenScraper(GenericEagerlyScraper):
    def __init__(self) -> None:
        super().__init__(cinema="Filmhallen", url_base="https://filmhallen.nl/")
