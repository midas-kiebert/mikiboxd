from fastapi import status

from .base import AppError


class MovieNotFoundError(AppError):
    status_code = status.HTTP_404_NOT_FOUND

    def __init__(self, movie_id: int):
        self.movie_id = movie_id
        detail = f"Movie with ID {movie_id} not found."
        super().__init__(detail)


class MovieConversionError(AppError):
    status_code = status.HTTP_422_UNPROCESSABLE_ENTITY

    def __init__(self, message: str):
        detail = f"Movie conversion error: {message}"
        super().__init__(detail)
