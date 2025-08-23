from .base import AppError


class ScraperStructureError(AppError):

    def __init__(self):
        detail = "Scraping did not go as expected, perhaps the structure of the page has changed."
        super().__init__(detail)
