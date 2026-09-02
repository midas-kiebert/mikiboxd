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
    openapi_description = "Returned when inviting a user who is not your friend."
    openapi_example = {"detail": "You can only invite your friends."}

    def __init__(self):
        super().__init__("You can only invite your friends.")


class ShowtimePingAlreadySentError(AppError):
    status_code = status.HTTP_409_CONFLICT
    openapi_description = (
        "Returned when inviting the same friend twice for the same showtime."
    )
    openapi_example = {"detail": "You already invited this friend for this showtime."}

    def __init__(self):
        super().__init__("You already invited this friend for this showtime.")


class ShowtimePingPastShowtimeError(AppError):
    status_code = status.HTTP_410_GONE
    openapi_description = (
        "Returned when inviting someone for a showtime that has already started."
    )
    openapi_example = {"detail": "This showtime has already passed."}

    def __init__(self):
        super().__init__("This showtime has already passed.")


class ShowtimePingSelfError(AppError):
    status_code = status.HTTP_400_BAD_REQUEST
    openapi_description = "Returned when trying to invite yourself."
    openapi_example = {"detail": "You cannot invite yourself."}

    def __init__(self):
        super().__init__("You cannot invite yourself.")


class ShowtimeReminderNonFriendError(AppError):
    status_code = status.HTTP_403_FORBIDDEN
    openapi_description = "Returned when reminding a user who is not your friend."
    openapi_example = {"detail": "You can only remind your friends."}

    def __init__(self):
        super().__init__("You can only remind your friends.")


class ShowtimeReminderNotGoingError(AppError):
    status_code = status.HTTP_403_FORBIDDEN
    openapi_description = (
        "Returned when the sender is not themselves going to this showtime."
    )
    openapi_example = {
        "detail": "You can only send reminders for showtimes you're going to."
    }

    def __init__(self):
        super().__init__("You can only send reminders for showtimes you're going to.")


class ShowtimeReminderNotEligibleError(AppError):
    status_code = status.HTTP_400_BAD_REQUEST
    openapi_description = (
        "Returned when the friend is neither going/interested nor has an "
        "active (non-dismissed) invite for this showtime."
    )
    openapi_example = {
        "detail": "This friend isn't going, interested, or invited to this showtime."
    }

    def __init__(self):
        super().__init__(
            "This friend isn't going, interested, or invited to this showtime."
        )


class ShowtimeReminderCooldownError(AppError):
    status_code = status.HTTP_429_TOO_MANY_REQUESTS
    openapi_description = (
        "Returned when this friend was already reminded about this showtime "
        "(by anyone) within the last 72 hours."
    )
    openapi_example = {
        "detail": "This friend was already reminded about this showtime recently."
    }

    def __init__(self):
        super().__init__(
            "This friend was already reminded about this showtime recently."
        )


class ShowtimePingInvalidLinkError(AppError):
    status_code = status.HTTP_400_BAD_REQUEST
    openapi_description = (
        "Returned when an invite link's token doesn't match any minted link, "
        "or was minted for a different showtime."
    )
    openapi_example = {"detail": "This invite link is invalid."}

    def __init__(self):
        super().__init__("This invite link is invalid.")


class SoldOutWatchNotAllowedError(AppError):
    status_code = status.HTTP_403_FORBIDDEN
    openapi_description = (
        "Returned when the account may not watch showtimes for returned tickets."
    )
    openapi_example = {"detail": "This account cannot watch showtimes for tickets."}

    def __init__(self) -> None:
        super().__init__("This account cannot watch showtimes for tickets.")


class SoldOutWatchNotApplicableError(AppError):
    status_code = status.HTTP_400_BAD_REQUEST
    openapi_description = (
        "Returned when the showtime still has seats, or when its ticket shop "
        "is one whose availability cannot be read."
    )
    openapi_example = {"detail": "This showtime is not sold out."}

    def __init__(self) -> None:
        super().__init__("This showtime is not sold out.")


class SoldOutWatchCapacityError(AppError):
    status_code = status.HTTP_409_CONFLICT
    openapi_description = (
        "Returned when the global limit on simultaneous ticket watches is reached."
    )
    openapi_example = {"detail": "Too many showtimes are being watched right now."}

    def __init__(self) -> None:
        super().__init__("Too many showtimes are being watched right now.")


class ShowtimeSeatValidationError(AppError):
    status_code = status.HTTP_400_BAD_REQUEST
    openapi_description = "Returned when the provided seat info is invalid."
    openapi_example = {
        "detail": "Invalid seat value for selected cinema seating preset."
    }

    def __init__(self, detail: str):
        super().__init__(detail)
