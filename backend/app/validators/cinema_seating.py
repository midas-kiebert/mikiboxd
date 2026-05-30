"""Cinema seating preset definitions and seat validation.

Different cinemas label their seats differently. Some use row numbers (1, 2, 3)
while others use row letters (A, B, C). This module defines the known seating
formats as an enum and provides validation to ensure that a seat entered by the
user actually matches the format the cinema uses.

The seating preset for each cinema is configured in:
    backend/data/cinemas.yaml

Example:
    A cinema with LETTER_NUMBER seating expects input like row="B", seat="12".
    Entering row="2" would be rejected because "2" is a number, not a letter.
"""

import re
from dataclasses import dataclass
from enum import Enum

__all__ = [
    "CinemaSeatingPreset",
    "validate_seat_for_preset",
]


class CinemaSeatingPreset(str, Enum):
    """The seat labelling format used by a cinema.

    The value encodes the format as "{row_type}-{seat_type}". For assigned-seating
    presets, the type is either "number" (1-2 digits) or "letter" (a single letter).

    Values:
      - unknown:        Row and seat can be a letter or 1-2 digits (flexible default).
      - free:           No assigned seating — no row/seat input allowed.
      - number-number:  Row is 1-2 digits, seat is 1-2 digits. E.g. row=3, seat=12.
      - letter-number:  Row is a letter, seat is 1-2 digits. E.g. row=B, seat=12.
      - number-letter:  Row is 1-2 digits, seat is a letter. E.g. row=3, seat=C.
      - letter-letter:  Row is a letter, seat is a letter. E.g. row=B, seat=C.
    """

    UNKNOWN = "unknown"
    FREE = "free"
    NUMBER_NUMBER = "number-number"
    LETTER_NUMBER = "letter-number"
    NUMBER_LETTER = "number-letter"
    LETTER_LETTER = "letter-letter"


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class _FieldRule:
    """A seat field validator: holds a regex pattern and a human-readable description."""

    pattern: re.Pattern[str]
    description: str

    def matches(self, value: str | None) -> bool:
        return value is not None and bool(self.pattern.fullmatch(value))


_NUMBER = _FieldRule(pattern=re.compile(r"^\d{1,2}$"), description="1-2 digits")
_LETTER = _FieldRule(pattern=re.compile(r"^[A-Za-z]$"), description="a single letter")

_FIELD_RULES: dict[str, _FieldRule] = {
    "number": _NUMBER,
    "letter": _LETTER,
}


@dataclass(frozen=True)
class _PresetRule:
    """The row and seat rules for a specific seating preset."""

    row: _FieldRule
    seat: _FieldRule

    @classmethod
    def from_preset(cls, preset: CinemaSeatingPreset) -> "_PresetRule":
        """Derive the row and seat rules from the preset's value string.

        The preset value encodes the format as "{row_type}-{seat_type}", so we
        can split on "-" to get the two field types and look up their rules.
        Only valid for assigned-seating presets (not UNKNOWN or FREE).
        """
        row_type, seat_type = preset.value.split("-")
        return cls(row=_FIELD_RULES[row_type], seat=_FIELD_RULES[seat_type])


def _matches_unknown(value: str | None) -> bool:
    """Accept None, a single letter, or 1-2 digits (the flexible 'unknown' format)."""
    if value is None:
        return True
    return _LETTER.matches(value) or _NUMBER.matches(value)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def validate_seat_for_preset(
    *,
    seating_preset: CinemaSeatingPreset,
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

    # Free seating cinemas don't have assigned seats at all.
    if seating_preset == CinemaSeatingPreset.FREE:
        raise ValueError(
            "This cinema uses free seating and does not support seat input."
        )

    # The UNKNOWN preset is flexible — accept letters or digits for both fields.
    if seating_preset == CinemaSeatingPreset.UNKNOWN:
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

    # All other presets encode their format as "{row_type}-{seat_type}" in their
    # value, so we can derive the validators directly from the preset name.
    rule = _PresetRule.from_preset(seating_preset)
    if seat_row is not None and not rule.row.matches(seat_row):
        raise ValueError(
            f"Invalid row value for seating='{seating_preset.value}'. "
            f"Use {rule.row.description}."
        )
    if seat_number is not None and not rule.seat.matches(seat_number):
        raise ValueError(
            f"Invalid seat value for seating='{seating_preset.value}'. "
            f"Use {rule.seat.description}."
        )
