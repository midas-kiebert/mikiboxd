from fastapi import status

from .base import AppError


class LetterboxdListNotFound(AppError):
    status_code = status.HTTP_404_NOT_FOUND
    detail = "Letterboxd list not found."


class InvalidLetterboxdListUrl(AppError):
    status_code = status.HTTP_400_BAD_REQUEST
    detail = "That is not a valid Letterboxd list URL or boxd.it link."


class LetterboxdListSyncTooSoon(AppError):
    status_code = status.HTTP_429_TOO_MANY_REQUESTS
    detail = "This list was synced recently. Please wait before syncing it again."
