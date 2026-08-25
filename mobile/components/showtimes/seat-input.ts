/**
 * Row/seat text-field validation, shared by the plain seat-editor dialog and
 * the floor-plan screen's own row/seat fields (selecting a seat on the floor
 * plan and typing it here stay in sync, so both need the same rules).
 *
 * Field kinds are derived from `Cinema.seating`, whose values are the
 * `CinemaSeatingPreset` enum from the backend (`"number-number"`,
 * `"letter-number"`, `"number-letter"`, `"letter-letter"`, `"free"`,
 * `"unknown"`) — match those exactly, not a `"row-x-seat-y"` shape.
 */

export type SeatFieldKind = "unknown" | "digits" | "letter";

export type SeatInputConfig = {
  rowKind: SeatFieldKind;
  seatKind: SeatFieldKind;
};

const SEAT_UNKNOWN_PATTERN = /^(?:\d{1,2}|[A-Za-z])$/;
const SEAT_DIGITS_PATTERN = /^\d{1,2}$/;
const SEAT_LETTER_PATTERN = /^[A-Za-z]$/;

export const getSeatInputConfig = (seating: string): SeatInputConfig => {
  switch (seating) {
    case "number-number":
      return { rowKind: "digits", seatKind: "digits" };
    case "letter-number":
      return { rowKind: "letter", seatKind: "digits" };
    case "number-letter":
      return { rowKind: "digits", seatKind: "letter" };
    case "letter-letter":
      return { rowKind: "letter", seatKind: "letter" };
    default:
      return { rowKind: "unknown", seatKind: "unknown" };
  }
};

export const getSeatFieldMaxLength = (kind: SeatFieldKind) => (kind === "letter" ? 1 : 2);

export const validateSeatFieldValue = (
  value: string | null,
  kind: SeatFieldKind,
  label: "Row" | "Seat"
) => {
  if (value === null) return null;
  if (kind === "digits" && !SEAT_DIGITS_PATTERN.test(value)) {
    return `${label} must be 1-2 digits.`;
  }
  if (kind === "letter" && !SEAT_LETTER_PATTERN.test(value)) {
    return `${label} must be one letter.`;
  }
  if (kind === "unknown" && !SEAT_UNKNOWN_PATTERN.test(value)) {
    return `${label} must be one letter or 1-2 digits.`;
  }
  return null;
};
