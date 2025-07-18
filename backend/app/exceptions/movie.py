__all__ = [
    "MovieError",
    "MovieNotFound",
]


class MovieError(Exception):
    """Base class for all movie-related exceptions."""

    def __init__(self, message: str = "An error occurred with the movie operation."):
        super().__init__(message)
        self.message = message


class MovieNotFound(MovieError):
    """Raised when a movie is not found in the database."""

    def __init__(self, slug: str | None = None, id: int | None = None):
        if slug:
            message = f"Movie with slug '{slug}' not found."
        elif id:
            message = f"Movie with ID '{id}' not found."
        else:
            message = "Movie not found."
        super().__init__(message)
        self.message = message
