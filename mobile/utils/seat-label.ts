/**
 * Seat labels, from `shared/showtimes/seat-label`.
 *
 * A wrapper rather than a copy: "F12" and "F-12" are different seats to read,
 * and the two clients must not disagree about which one they print.
 */
export { formatSeatLabel } from "shared/showtimes/seat-label";
