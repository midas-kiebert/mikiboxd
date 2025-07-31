from fastapi import status

from .base import AppError


class WatchlistSyncTooSoon(AppError):
    status_code = status.HTTP_429_TOO_MANY_REQUESTS

    def __init__(self):
        detail = "You are syncing your watchlist too soon after the last sync. Please wait before trying again."
        super().__init__(detail)
