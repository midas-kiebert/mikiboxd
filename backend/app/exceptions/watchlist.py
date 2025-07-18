__all__ = [
    "WatchlistError",
    "WatchlistSelectionAlreadyExists",
    "WatchlistSelectionInvalid",
    "WatchlistSelectionNotFound",
]


class WatchlistError(Exception):
    """Base class for all watchlist-related exceptions."""

    def __init__(
        self, message: str = "An error occurred with the watchlist operation."
    ):
        super().__init__(message)
        self.message = message


class WatchlistSelectionAlreadyExists(WatchlistError):
    """Raised when a watchlist selection already exists for a user and movie."""

    def __init__(self, message: str = "Watchlist selection already exists."):
        super().__init__(message)
        self.message = message


class WatchlistSelectionInvalid(WatchlistError):
    """Raised when a watchlist selection is invalid, such as when the user or movie does not exist."""

    def __init__(self, message: str = "Invalid watchlist selection."):
        super().__init__(message)
        self.message = message


class WatchlistSelectionNotFound(WatchlistError):
    """Raised when a watchlist selection is not found for a user and movie."""

    def __init__(self, message: str = "Watchlist selection not found."):
        super().__init__(message)
        self.message = message
