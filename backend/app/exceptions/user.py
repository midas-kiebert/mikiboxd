__all__ = [
    "UserError",
    "UserNotFound",
    "UserLetterboxdUsernameNotSet",
]


class UserError(Exception):
    """Base class for all user-related exceptions."""


class UserNotFound(UserError):
    """Raised when a user is not found in the database."""


class UserLetterboxdUsernameNotSet(UserError):
    """Raised when a user has not set their Letterboxd username."""
