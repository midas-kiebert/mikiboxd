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


class ShowtimePingNonFriendError(AppError):
    status_code = status.HTTP_403_FORBIDDEN
    openapi_description = "Returned when pinging a user who is not your friend."
    openapi_example = {"detail": "You can only ping your friends."}

    def __init__(self):
        super().__init__("You can only ping your friends.")


class ShowtimePingAlreadySelectedError(AppError):
    status_code = status.HTTP_409_CONFLICT
    openapi_description = "Returned when pinging a friend who already marked the showtime as going/interested."
    openapi_example = {"detail": "This friend already selected this showtime."}

    def __init__(self):
        super().__init__("This friend already selected this showtime.")


class ShowtimePingAlreadySentError(AppError):
    status_code = status.HTTP_409_CONFLICT
    openapi_description = (
        "Returned when pinging the same friend twice for the same showtime."
    )
    openapi_example = {"detail": "You already pinged this friend for this showtime."}

    def __init__(self):
        super().__init__("You already pinged this friend for this showtime.")


class ShowtimePingSelfError(AppError):
    status_code = status.HTTP_400_BAD_REQUEST
    openapi_description = "Returned when trying to ping yourself."
    openapi_example = {"detail": "You cannot ping yourself."}

    def __init__(self):
        super().__init__("You cannot ping yourself.")


class ShowtimePingSenderNotFoundError(AppError):
    status_code = status.HTTP_404_NOT_FOUND
    openapi_description = "Returned when a ping link sender cannot be resolved."
    openapi_example = {"detail": "Sender for this ping link was not found."}

    def __init__(self):
        super().__init__("Sender for this ping link was not found.")


class ShowtimePingSenderAmbiguousError(AppError):
    status_code = status.HTTP_409_CONFLICT
    openapi_description = (
        "Returned when a ping link sender identifier matches multiple users."
    )
    openapi_example = {"detail": "Ping link sender is ambiguous. Use a user ID link."}

    def __init__(self):
        super().__init__("Ping link sender is ambiguous. Use a user ID link.")


class ShowtimeSeatValidationError(AppError):
    status_code = status.HTTP_400_BAD_REQUEST
    openapi_description = "Returned when the provided seat info is invalid."
    openapi_example = {
        "detail": "Invalid seat value for selected cinema seating preset."
    }

    def __init__(self, detail: str):
        super().__init__(detail)
