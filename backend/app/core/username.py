import re

USERNAME_MIN_LENGTH = 4
USERNAME_MAX_LENGTH = 15
USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9_]+$")
USERNAME_VALIDATION_MESSAGE = f"Username must be {USERNAME_MIN_LENGTH}-{USERNAME_MAX_LENGTH} characters and use only letters, numbers, and underscores."


def normalize_username(value: str | None) -> str | None:
    if value is None:
        return None
    return value.strip()


def is_valid_username(value: str) -> bool:
    if len(value) < USERNAME_MIN_LENGTH or len(value) > USERNAME_MAX_LENGTH:
        return False
    return USERNAME_PATTERN.fullmatch(value) is not None
