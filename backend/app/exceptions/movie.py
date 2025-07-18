__all__ = [
    "MovieError",
    "MovieNotFound",
]


class MovieError(Exception):
    """Base class for all movie-related exceptions."""


class MovieNotFound(MovieError):
    """Raised when a movie is not found in the database."""
