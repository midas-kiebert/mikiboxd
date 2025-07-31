from uuid import UUID

from fastapi import status

from .base import AppError


class ShowtimeNotFoundError(AppError):
    status_code = status.HTTP_404_NOT_FOUND
    openapi_description = "Returned when the requested showtime does not exist."
    openapi_example = {"detail": "Showtime with ID 123 not found."}

    def __init__(self, showtime_id: int):
        self.movie_id = showtime_id
        detail = f"Showtime with ID {showtime_id} not found."
        super().__init__(detail)


class ShowtimeOrUserNotFoundError(AppError):
    status_code = status.HTTP_404_NOT_FOUND
    openapi_description = "Returned when the requested showtime or user does not exist."
    openapi_example = {"detail": "Showtime with ID 123 or user with ID 456 not found."}

    def __init__(self, showtime_id: int, user_id: UUID):
        self.showtime_id = showtime_id
        self.user_id = user_id
        detail = f"Showtime with ID {showtime_id} or user with ID {user_id} not found."
        super().__init__(detail)


class ShowtimeAlreadySelectedError(AppError):
    status_code = status.HTTP_409_CONFLICT
    openapi_description = "Returned when the showtime is already selected by the user."
    openapi_example = {
        "detail": "Showtime with ID 123 is already selected by user with ID 456."
    }

    def __init__(self, showtime_id: int, user_id: UUID):
        self.showtime_id = showtime_id
        self.user_id = user_id
        detail = f"Showtime with ID {showtime_id} is already selected by user with ID {user_id}."
        super().__init__(detail)


class ShowtimeSelectionNotFoundError(AppError):
    status_code = status.HTTP_404_NOT_FOUND
    openapi_description = "Returned when the showtime selection does not exist."
    openapi_example = {"detail": "Showtime selection with ID 123 not found."}

    def __init__(self, showtime_id: int, user_id: UUID):
        self.showtime_id = showtime_id
        self.user_id = user_id
        detail = f"Showtime selection with ID {showtime_id} for user with ID {user_id} not found."
        super().__init__(detail)
