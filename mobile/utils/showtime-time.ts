/**
 * Showtime times, from `shared/showtimes/showtime-time`.
 *
 * A wrapper rather than a copy, so both clients compare a zone-less Amsterdam
 * wall-clock time in Amsterdam and write a time range the same way.
 */
export {
  formatShowtimeTimeRange,
  hasShowtimeStarted,
} from "shared/showtimes/showtime-time";
