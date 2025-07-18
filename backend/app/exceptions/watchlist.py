__all__ = [
    "WatchlistSelectionError",
    "WatchlistSelectionAlreadyExists",
    "WatchlistSelectionInvalid",
    "WatchlistSelectionNotFound",
]


class WatchlistSelectionError(Exception):
    """Base class for all watchlist-related exceptions."""


class WatchlistSelectionAlreadyExists(WatchlistSelectionError):
    """Raised when a watchlist selection already exists for a user and movie."""


class WatchlistSelectionInvalid(WatchlistSelectionError):
    """Raised when a watchlist selection is invalid, such as when the user or movie does not exist."""


class WatchlistSelectionNotFound(WatchlistSelectionError):
    """Raised when a watchlist selection is not found for a user and movie."""
