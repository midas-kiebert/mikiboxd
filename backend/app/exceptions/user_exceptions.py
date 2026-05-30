from uuid import UUID

from fastapi import status

from app.validators.username import USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH

from .base import AppError


class UserNotFound(AppError):
    status_code = status.HTTP_404_NOT_FOUND

    def __init__(self, user_id: UUID):
        detail = f"User with id {user_id} not found."
        super().__init__(detail)


class LetterboxdUsernameNotSet(AppError):
    status_code = status.HTTP_400_BAD_REQUEST

    def __init__(self):
        detail = "Letterboxd username is not set for the user."
        super().__init__(detail)


class EmailAlreadyExists(AppError):
    status_code = status.HTTP_409_CONFLICT

    def __init__(self, email: str):
        detail = f"User with email {email} already exists."
        super().__init__(detail)


class DisplayNameAlreadyExists(AppError):
    status_code = status.HTTP_409_CONFLICT

    def __init__(self, display_name: str):
        detail = f"User with username {display_name} already exists."
        super().__init__(detail)


class UsernameRequired(AppError):
    status_code = status.HTTP_400_BAD_REQUEST

    def __init__(self):
        super().__init__("Username is required.")


class InvalidUsername(AppError):
    status_code = status.HTTP_400_BAD_REQUEST

    def __init__(self):
        super().__init__(
            f"Username must be {USERNAME_MIN_LENGTH}-{USERNAME_MAX_LENGTH} characters "
            "and use only letters, numbers, and underscores."
        )


class OneOrMoreUsersNotFound(AppError):
    status_code = status.HTTP_404_NOT_FOUND

    def __init__(self, user_ids: list[UUID]):
        detail = f"One or more users not found: {', '.join(str(user_id) for user_id in user_ids)}."
        super().__init__(detail)


class NotAFriend(AppError):
    status_code = status.HTTP_403_FORBIDDEN

    def __init__(self, user_id: UUID):
        detail = f"User with id {user_id} is not a friend."
        super().__init__(detail)
