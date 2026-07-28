from fastapi import status

from .base import AppError


class ScraperStructureError(AppError):
    def __init__(self):
        detail = "Scraping did not go as expected, perhaps the structure of the page has changed."
        super().__init__(detail)


class LetterboxdTemporarilyUnavailable(AppError):
    """Letterboxd refused or throttled the request; the data is unchanged.

    Distinct from `ScraperStructureError`: nothing is wrong with our parsing or
    with the user's account, so this must not surface as a 500 or make the
    caller give up on the account — it is a "come back later".
    """

    status_code = status.HTTP_503_SERVICE_UNAVAILABLE

    def __init__(self, detail: str | None = None):
        super().__init__(
            detail or "Letterboxd is currently unavailable. Please try again later."
        )
