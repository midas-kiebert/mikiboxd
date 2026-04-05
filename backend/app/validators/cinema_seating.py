"""Cinema seating preset definitions and seat validation.

Different cinemas label their seats differently. Some use row numbers (1, 2, 3)
while others use row letters (A, B, C). This module defines the known seating
formats as an enum and provides validation to ensure that a seat entered by the
user actually matches the format the cinema uses.

Example:
    A cinema with ROW_LETTER_SEAT_NUMBER seating expects input like row="B",
    seat="12". Entering row="2" would be rejected because "2" is a number, not a
    letter, so it doesn't fit the expected format for that cinema.
"""

import re
from collections.abc import Callable
from enum import Enum

__all__ = [
    "CinemaSeatingPreset",
    "DEFAULT_CINEMA_SEATING_PRESET",
    "CINEMA_SEATING_PRESET_NAMES",
    "normalize_cinema_seating_preset",
    "validate_seat_for_preset",
]


class CinemaSeatingPreset(str, Enum):
    """The seat labelling format used by a cinema.

    Each value describes how the row and seat are identified:
      - UNKNOWN:                Row and seat can be a letter or 1-2 digits (flexible).
      - FREE:                   No assigned seating — no row/seat input allowed.
      - ROW_NUMBER_SEAT_NUMBER: Row is 1-2 digits, seat is 1-2 digits. E.g. row=3, seat=12.
      - ROW_LETTER_SEAT_NUMBER: Row is a letter, seat is 1-2 digits. E.g. row=B, seat=12.
      - ROW_NUMBER_SEAT_LETTER: Row is 1-2 digits, seat is a letter. E.g. row=3, seat=C.
      - ROW_LETTER_SEAT_LETTER: Row is a letter, seat is a letter. E.g. row=B, seat=C.
    """

    UNKNOWN = "unknown"
    FREE = "free"
    ROW_NUMBER_SEAT_NUMBER = "row-number-seat-number"
    ROW_LETTER_SEAT_NUMBER = "row-letter-seat-number"
    ROW_NUMBER_SEAT_LETTER = "row-number-seat-letter"
    ROW_LETTER_SEAT_LETTER = "row-letter-seat-letter"


DEFAULT_CINEMA_SEATING_PRESET = CinemaSeatingPreset.UNKNOWN.value
CINEMA_SEATING_PRESET_NAMES = tuple(preset.value for preset in CinemaSeatingPreset)

# ---------------------------------------------------------------------------
# Private validators — each returns True if the value matches the expected format
# ---------------------------------------------------------------------------

_ONE_LETTER_PATTERN = re.compile(r"^[A-Za-z]$")
_ONE_OR_TWO_DIGITS_PATTERN = re.compile(r"^\d{1,2}$")


def _matches_number(value: str | None) -> bool:
    return value is not None and bool(_ONE_OR_TWO_DIGITS_PATTERN.fullmatch(value))


def _matches_letter(value: str | None) -> bool:
    return value is not None and bool(_ONE_LETTER_PATTERN.fullmatch(value))


def _matches_unknown(value: str | None) -> bool:
    """Accept None, a single letter, or 1-2 digits (the flexible 'unknown' format)."""
    if value is None:
        return True
    return _matches_letter(value) or _matches_number(value)


# ---------------------------------------------------------------------------
# Preset validation rules
#
# Maps each preset to (row_validator, row_description, seat_validator, seat_description).
# Used by validate_seat_for_preset to check input without repeating the same
# if/raise pattern for every preset.
# ---------------------------------------------------------------------------

_Validator = Callable[[str | None], bool]

_PRESET_RULES: dict[str, tuple[_Validator, str, _Validator, str]] = {
    CinemaSeatingPreset.ROW_NUMBER_SEAT_NUMBER.value: (
        _matches_number, "1-2 digits",
        _matches_number, "1-2 digits",
    ),
    CinemaSeatingPreset.ROW_LETTER_SEAT_NUMBER.value: (
        _matches_letter, "a single letter",
        _matches_number, "1-2 digits",
    ),
    CinemaSeatingPreset.ROW_NUMBER_SEAT_LETTER.value: (
        _matches_number, "1-2 digits",
        _matches_letter, "a single letter",
    ),
    CinemaSeatingPreset.ROW_LETTER_SEAT_LETTER.value: (
        _matches_letter, "a single letter",
        _matches_letter, "a single letter",
    ),
}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def normalize_cinema_seating_preset(
    value: str | CinemaSeatingPreset | None,
) -> str:
    """Coerce a seating preset value to its canonical string form.

    Accepts a CinemaSeatingPreset enum member, a raw string, or None.
    Raises ValueError if the string is not a known preset.

    Args:
        value: The preset to normalize. None returns the default preset.

    Returns:
        The canonical string value of the preset (e.g. "row-letter-seat-number").
    """
    if value is None:
        return DEFAULT_CINEMA_SEATING_PRESET

    if isinstance(value, CinemaSeatingPreset):
        normalized = value.value
    else:
        normalized = value.strip().lower()

    if not normalized:
        return DEFAULT_CINEMA_SEATING_PRESET

    if normalized not in CINEMA_SEATING_PRESET_NAMES:
        raise ValueError(
            "Invalid cinema seating preset. "
            f"Allowed values: {', '.join(CINEMA_SEATING_PRESET_NAMES)}."
        )

    return normalized


def validate_seat_for_preset(
    *,
    seating_preset: str | CinemaSeatingPreset,
    seat_row: str | None,
    seat_number: str | None,
) -> None:
    """Validate that a seat row/number pair is valid for the given seating preset.

    Raises ValueError with a descriptive message if the input doesn't match the
    expected format. Returns None silently if the input is valid.

    Args:
        seating_preset: The cinema's seating format (see CinemaSeatingPreset).
        seat_row:       The row identifier entered by the user, or None.
        seat_number:    The seat identifier entered by the user, or None.

    Raises:
        ValueError: If the row/seat combination is invalid for the preset.
    """
    # An entirely empty pair means "no seat selected" — always valid.
    if seat_row is None and seat_number is None:
        return

    # Partial input (one set, one not) is never valid.
    if (seat_row is None) != (seat_number is None):
        raise ValueError(
            "Seat row and seat number must either both be set or both be empty."
        )

    normalized_preset = normalize_cinema_seating_preset(seating_preset)

    # Free seating cinemas don't have assigned seats at all.
    if normalized_preset == CinemaSeatingPreset.FREE.value:
        raise ValueError(
            "This cinema uses free seating and does not support seat input."
        )

    # The UNKNOWN preset is flexible — accept letters or digits for both fields.
    if normalized_preset == CinemaSeatingPreset.UNKNOWN.value:
        if not _matches_unknown(seat_row):
            raise ValueError(
                "Invalid row value for seating='unknown'. "
                "Use a single letter or 1-2 digits."
            )
        if not _matches_unknown(seat_number):
            raise ValueError(
                "Invalid seat value for seating='unknown'. "
                "Use a single letter or 1-2 digits."
            )
        return

    # All remaining presets follow a fixed pattern — look up the rules and apply them.
    if normalized_preset in _PRESET_RULES:
        row_validator, row_desc, seat_validator, seat_desc = _PRESET_RULES[
            normalized_preset
        ]
        if seat_row is not None and not row_validator(seat_row):
            raise ValueError(
                f"Invalid row value for seating='{normalized_preset}'. "
                f"Use {row_desc}."
            )
        if seat_number is not None and not seat_validator(seat_number):
            raise ValueError(
                f"Invalid seat value for seating='{normalized_preset}'. "
                f"Use {seat_desc}."
            )
