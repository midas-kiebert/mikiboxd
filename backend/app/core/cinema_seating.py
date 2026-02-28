import re
from enum import Enum

__all__ = [
    "CinemaSeatingPreset",
    "DEFAULT_CINEMA_SEATING_PRESET",
    "CINEMA_SEATING_PRESET_NAMES",
    "normalize_cinema_seating_preset",
    "validate_seat_for_preset",
]


class CinemaSeatingPreset(str, Enum):
    UNKNOWN = "unknown"
    FREE = "free"
    ROW_NUMBER_SEAT_NUMBER = "row-number-seat-number"
    ROW_LETTER_SEAT_NUMBER = "row-letter-seat-number"
    ROW_NUMBER_SEAT_LETTER = "row-number-seat-letter"
    ROW_LETTER_SEAT_LETTER = "row-letter-seat-letter"


DEFAULT_CINEMA_SEATING_PRESET = CinemaSeatingPreset.UNKNOWN.value
CINEMA_SEATING_PRESET_NAMES = tuple(preset.value for preset in CinemaSeatingPreset)

_ONE_LETTER_PATTERN = re.compile(r"^[A-Za-z]$")
_ONE_OR_TWO_DIGITS_PATTERN = re.compile(r"^\d{1,2}$")


def normalize_cinema_seating_preset(
    value: str | CinemaSeatingPreset | None,
) -> str:
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


def _matches_number(value: str | None) -> bool:
    return value is not None and bool(_ONE_OR_TWO_DIGITS_PATTERN.fullmatch(value))


def _matches_letter(value: str | None) -> bool:
    return value is not None and bool(_ONE_LETTER_PATTERN.fullmatch(value))


def _matches_unknown(value: str | None) -> bool:
    if value is None:
        return True
    return _matches_letter(value) or _matches_number(value)


def validate_seat_for_preset(
    *,
    seating_preset: str | CinemaSeatingPreset,
    seat_row: str | None,
    seat_number: str | None,
) -> None:
    # Treat an empty pair as "no seat selected" for every seating preset.
    if seat_row is None and seat_number is None:
        return

    normalized_preset = normalize_cinema_seating_preset(seating_preset)

    if normalized_preset == CinemaSeatingPreset.FREE.value and (
        seat_row is not None or seat_number is not None
    ):
        raise ValueError(
            "This cinema uses free seating and does not support seat input."
        )

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

    if normalized_preset == CinemaSeatingPreset.ROW_NUMBER_SEAT_NUMBER.value:
        if seat_row is not None and not _matches_number(seat_row):
            raise ValueError(
                "Invalid row value for seating='row-number-seat-number'. "
                "Use 1-2 digits."
            )
        if seat_number is not None and not _matches_number(seat_number):
            raise ValueError(
                "Invalid seat value for seating='row-number-seat-number'. "
                "Use 1-2 digits."
            )
        return

    if normalized_preset == CinemaSeatingPreset.ROW_LETTER_SEAT_NUMBER.value:
        if seat_row is not None and not _matches_letter(seat_row):
            raise ValueError(
                "Invalid row value for seating='row-letter-seat-number'. "
                "Use a single letter."
            )
        if seat_number is not None and not _matches_number(seat_number):
            raise ValueError(
                "Invalid seat value for seating='row-letter-seat-number'. "
                "Use 1-2 digits."
            )
        return

    if normalized_preset == CinemaSeatingPreset.ROW_NUMBER_SEAT_LETTER.value:
        if seat_row is not None and not _matches_number(seat_row):
            raise ValueError(
                "Invalid row value for seating='row-number-seat-letter'. "
                "Use 1-2 digits."
            )
        if seat_number is not None and not _matches_letter(seat_number):
            raise ValueError(
                "Invalid seat value for seating='row-number-seat-letter'. "
                "Use a single letter."
            )
        return

    if normalized_preset == CinemaSeatingPreset.ROW_LETTER_SEAT_LETTER.value:
        if seat_row is not None and not _matches_letter(seat_row):
            raise ValueError(
                "Invalid row value for seating='row-letter-seat-letter'. "
                "Use a single letter."
            )
        if seat_number is not None and not _matches_letter(seat_number):
            raise ValueError(
                "Invalid seat value for seating='row-letter-seat-letter'. "
                "Use a single letter."
            )
