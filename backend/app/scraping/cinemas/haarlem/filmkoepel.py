from app.scraping.cinemas.generic.eagerly import GenericEagerlyScraper


class FilmkoepelScraper(GenericEagerlyScraper):
    def __init__(self) -> None:
        super().__init__(cinema_key="filmkoepel", url_base="https://www.filmkoepel.nl/")
