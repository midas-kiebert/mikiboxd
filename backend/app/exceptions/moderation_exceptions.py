from uuid import UUID

from fastapi import status

from .base import AppError


class CannotBlockSelfError(AppError):
    status_code = status.HTTP_400_BAD_REQUEST
    detail = "You cannot block yourself."


class CannotReportSelfError(AppError):
    status_code = status.HTTP_400_BAD_REQUEST
    detail = "You cannot report yourself."


class UserBlockNotFoundError(AppError):
    status_code = status.HTTP_404_NOT_FOUND

    def __init__(self, blocker_id: UUID, blocked_id: UUID):
        detail = (
            f"Block not found. User with id {blocker_id} has not blocked user "
            f"with id {blocked_id}."
        )
        super().__init__(detail)


class UserBlockedError(AppError):
    """Raised when a blocked relationship stops a contact attempt.

    Deliberately vague about which direction the block runs in, and worded the
    same either way: telling the sender "they blocked you" hands a harasser
    exactly the feedback they were looking for.
    """

    status_code = status.HTTP_403_FORBIDDEN
    detail = "This isn't available."


class ObjectionableUsernameError(AppError):
    status_code = status.HTTP_400_BAD_REQUEST
    detail = "Please choose a different username."
