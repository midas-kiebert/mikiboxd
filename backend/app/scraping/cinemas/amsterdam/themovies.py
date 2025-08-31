from app.scraping.cinemas.generic.eagerly import GenericEagerlyScraper


class TheMoviesScraper(GenericEagerlyScraper):
    def __init__(self) -> None:
        super().__init__(cinema="The Movies", url_base="https://themovies.nl/")
