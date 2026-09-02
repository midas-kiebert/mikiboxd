from fastapi import status

from .base import AppError


class WatchlistDigestSourceNotFound(AppError):
    status_code = status.HTTP_404_NOT_FOUND
    detail = "Watchlist digest source not found."


class WatchlistDigestSourceLimitReached(AppError):
    status_code = status.HTTP_400_BAD_REQUEST
    detail = "You've reached the limit of watchlist digest sources."


class WatchlistDigestSourceCinemaSelectionConflict(AppError):
    status_code = status.HTTP_400_BAD_REQUEST
    detail = "cinema_preset_id and custom_cinema_ids are mutually exclusive."
