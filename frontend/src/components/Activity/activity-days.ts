/**
 * The Activity list's days: rows grouped under the evening they belong to.
 *
 * Grouped by *evening*, not by calendar date: a 00:30 screening is planned and
 * talked about as part of the night before, so it files under that night's
 * heading rather than opening a day of its own for one late show. The same
 * rule `shared/showtimes/day-label` uses to call it "Tonight".
 */
import type { ShowtimePublic } from "shared"
import { type DayReference, relativeDayLabel } from "shared/showtimes/day-label"

/** Screenings before this hour are the previous evening's. */
const SMALL_HOURS_UNTIL = 4

const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})/
const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
]
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
]

export type ActivityDay = {
  /** The evening as `YYYY-MM-DD`, the form the server's day counts use. */
  day: string
  key: string
  /** "Today", "Tomorrow", or the weekday. */
  label: string
  /** The weekday, when `label` is a relative one; otherwise null. */
  weekday: string | null
  dayOfMonth: number
  month: string
  showtimes: ShowtimePublic[]
}

const pad = (value: number) => String(value).padStart(2, "0")

const isoDay = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

/** The evening a screening belongs to, as a local-midnight date. */
const eveningOf = (showtime: ShowtimePublic): Date => {
  const match = WALL_CLOCK.exec(showtime.datetime)
  const [, year, month, day, hour] = match ?? ["", "1970", "01", "01", "00"]
  const shift = Number(hour) < SMALL_HOURS_UNTIL ? 1 : 0
  return new Date(Number(year), Number(month) - 1, Number(day) - shift)
}

/**
 * Consecutive runs of the list, in the order the server sent them (by time).
 * A day that reappears later — it cannot, on a list sorted by time, but a
 * page boundary is not worth trusting — gets a heading of its own.
 */
export const groupByEvening = (
  showtimes: ShowtimePublic[],
  reference: DayReference,
): ActivityDay[] => {
  const days: ActivityDay[] = []
  for (const showtime of showtimes) {
    const evening = eveningOf(showtime)
    const day = isoDay(evening)
    const last = days[days.length - 1]
    if (last?.day === day) {
      last.showtimes.push(showtime)
      continue
    }
    // Noon, so the small-hours "Tonight" relabel never applies: the evening
    // itself is either today or tomorrow.
    const noon = new Date(
      evening.getFullYear(),
      evening.getMonth(),
      evening.getDate(),
      12,
    )
    const relative = relativeDayLabel(noon, reference)
    const weekday = WEEKDAYS[evening.getDay()]
    days.push({
      day,
      key: days.some((known) => known.day === day)
        ? `${day}-${days.length}`
        : day,
      label: relative ?? weekday,
      weekday: relative ? weekday : null,
      dayOfMonth: evening.getDate(),
      month: MONTHS[evening.getMonth()],
      showtimes: [showtime],
    })
  }
  return days
}
