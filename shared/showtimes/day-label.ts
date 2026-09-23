/**
 * Which day a screening reads as: "Today", "Tonight", "Tomorrow", or nothing
 * (in which case the caller prints the date).
 *
 * Here rather than in either client because it is wording, and the two have to
 * say the same thing about the same screening — the same reason
 * `seat-availability-level` and `friend-watch-kind` live in `shared`.
 *
 * The rule that is not obvious: **a screening in the small hours belongs to
 * the evening you are standing in**. A 00:30 show is sold, planned and talked
 * about as part of tonight, not as "tomorrow", and a feed that calls it
 * tomorrow at nine in the evening is telling you to come back another day for
 * something starting in three hours. So between 06:00 and midnight, anything
 * on tomorrow's date before 04:00 is "Tonight". Before six in the morning the
 * relabel is off: at 02:00 the small hours are *today* already, and the next
 * night really is tomorrow's.
 *
 * The reference is passed in rather than read from the clock, so that every
 * row on a page is labelled against one instant. A page that reads the clock
 * per card relabels its rows one at a time as they happen to re-render, which
 * is exactly what it looks like: cross midnight with a feed open, click a
 * card, and that card alone says "Tomorrow" while the rest still say "Today".
 */

/** A date as a sortable number, for comparing days without comparing times. */
export const dayKeyOf = (date: Date): number =>
  date.getFullYear() * 10000 + date.getMonth() * 100 + date.getDate();

/** The day a page is being read on, fixed at one instant. */
export type DayReference = {
  today: number;
  tomorrow: number;
  /**
   * Whether the reader is in the part of the day that has an evening ahead of
   * it (06:00 onwards) — which is what decides whether tomorrow's small hours
   * are "tonight".
   */
  evening: boolean;
};

/** The hour from which the small hours ahead of you count as tonight. */
const EVENING_FROM_HOUR = 6;

/** Screenings before this hour are the previous evening's. */
const SMALL_HOURS_UNTIL = 4;

export const dayReferenceAt = (now: Date): DayReference => {
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return {
    today: dayKeyOf(now),
    tomorrow: dayKeyOf(tomorrow),
    evening: now.getHours() >= EVENING_FROM_HOUR,
  };
};

export type RelativeDay = "Today" | "Tonight" | "Tomorrow";

/**
 * `null` when the screening is far enough off to deserve its date.
 *
 * `start` is the screening's own wall-clock time as a `Date` — the digits the
 * cinema published, not an instant in any zone.
 */
export const relativeDayLabel = (
  start: Date,
  reference: DayReference,
): RelativeDay | null => {
  const key = dayKeyOf(start);
  if (key === reference.today) return "Today";
  if (key !== reference.tomorrow) return null;
  return reference.evening && start.getHours() < SMALL_HOURS_UNTIL
    ? "Tonight"
    : "Tomorrow";
};
