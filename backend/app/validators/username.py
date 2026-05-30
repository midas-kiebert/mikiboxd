"""Username validation rules.

Centralising the rules here means that the same constraints are enforced
consistently whether the username is being set at registration, updated in
settings, or checked anywhere else in the codebase.
"""

import re

USERNAME_MIN_LENGTH = 4
USERNAME_MAX_LENGTH = 15
_USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9_]+$")


def is_valid_username(value: str) -> bool:
    """Return True if the username satisfies all constraints.

    Checks:
      - Length is between USERNAME_MIN_LENGTH and USERNAME_MAX_LENGTH (inclusive)
      - Contains only letters, digits, and underscores (no spaces or symbols)
    """
    if len(value) < USERNAME_MIN_LENGTH or len(value) > USERNAME_MAX_LENGTH:
        return False
    return _USERNAME_PATTERN.fullmatch(value) is not None
