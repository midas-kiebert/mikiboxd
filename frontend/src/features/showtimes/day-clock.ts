/**
 * The one day every row on the page is labelled against.
 *
 * `when()` and the film cards used to read the clock themselves, cached for a
 * minute. That is correct per card and wrong per page: nothing re-renders a
 * card just because the minute changed, so after midnight a feed relabels
 * itself *one row at a time*, as rows happen to re-render for other reasons.
 * Click a card at 00:01 and that card alone starts saying "Tomorrow" while
 * every row around it still says "Today".
 *
 * So the day lives in one place, changes in one place, and everything that
 * prints a day subscribes to it: when it does change, every subscriber is
 * notified in the same batch and the whole page flips together.
 *
 * The value is compared by day rather than by clock, so the store notifies
 * twice a day at most — at midnight, and at 06:00 where tomorrow's small
 * hours stop being "tonight" (see `shared/showtimes/day-label`). The ticker
 * only runs while something is subscribed.
 */
import { useSyncExternalStore } from "react"
import { type DayReference, dayReferenceAt } from "shared/showtimes/day-label"

const CHECK_INTERVAL_MS = 60_000

let reference = dayReferenceAt(new Date())
const listeners = new Set<() => void>()
let ticker: ReturnType<typeof setInterval> | null = null

const check = () => {
  const next = dayReferenceAt(new Date())
  if (next.today === reference.today && next.evening === reference.evening)
    return
  reference = next
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  if (!ticker) ticker = setInterval(check, CHECK_INTERVAL_MS)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && ticker) {
      clearInterval(ticker)
      ticker = null
    }
  }
}

/** For the plain functions — `when()` and the film kit — outside React. */
export const currentDay = (): DayReference => reference

/**
 * For anything that *prints* a day. A card that draws a date must call this,
 * even if it throws the value away: the point is the subscription, and a
 * memoised card that does not hold one will keep yesterday's label until
 * something else re-renders it.
 */
export const useDayClock = (): DayReference =>
  useSyncExternalStore(subscribe, currentDay, currentDay)
