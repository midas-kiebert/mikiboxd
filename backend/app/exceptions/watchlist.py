__all__ = [
    "WatchlistError",
    "WatchlistSelectionAlreadyExists",
    "WatchlistSelectionInvalid",
    "WatchlistSelectionNotFound",
]


class WatchlistError(Exception):
    """Base class for all watchlist-related exceptions."""


class WatchlistSelectionAlreadyExists(WatchlistError):
    """Raised when a watchlist selection already exists for a user and movie."""


class WatchlistSelectionInvalid(WatchlistError):
    """Raised when a watchlist selection is invalid, such as when the user or movie does not exist."""


class WatchlistSelectionNotFound(WatchlistError):
    """Raised when a watchlist selection is not found for a user and movie."""
