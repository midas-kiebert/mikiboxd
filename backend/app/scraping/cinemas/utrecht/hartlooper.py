from app.scraping.cinemas.generic.eagerly import GenericEagerlyScraper


class LouisHartlooperComplexScraper(GenericEagerlyScraper):
    def __init__(self) -> None:
        super().__init__(
            cinema="Louis Hartlooper Complex",
            url_base="https://www.hartlooper.nl/",
            subtitle_venue_aliases=["lhc", "hartlooper"],
        )
