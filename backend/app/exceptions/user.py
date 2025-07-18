__all__ = [
    "UserError",
    "UserNotFound",
    "UserLetterboxdUsernameNotSet",
]


class UserError(Exception):
    """Base class for all user-related exceptions."""

    def __init__(self, message: str = "An error occurred with the user operation."):
        super().__init__(message)
        self.message = message


class UserNotFound(UserError):
    """Raised when a user is not found in the database."""

    def __init__(self, message: str = "User not found."):
        super().__init__(message)
        self.message = message


class UserLetterboxdUsernameNotSet(UserError):
    """Raised when a user has not set their Letterboxd username."""

    def __init__(self, message: str = "User's Letterboxd username is not set."):
        super().__init__(message)
        self.message = message
