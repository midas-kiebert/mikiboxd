/**
 * "Open this screening in your side panel", for pages that have one.
 *
 * The notification panel floats over whatever page you are on, and a
 * notification about a screening should open it *there* — in the showtimes
 * feed's, the films feed's, Activity's or a film page's own detail panel —
 * rather than navigating away from what you were looking at. Pages without a
 * panel (Friends, Settings) register nothing, and the caller falls back to
 * the film's page.
 *
 * A module-level slot, the same shape as `Feed/feed-search-slot.ts`: the
 * notification panel is a sibling of the page, not a child of it, and only one
 * page is on screen at a time.
 */
import { useLayoutEffect } from "react"
import type { ShowtimePublic } from "shared"

type OpenShowtime = (showtime: ShowtimePublic) => void

let opener: OpenShowtime | null = null

/**
 * A screening waiting for the next page with a panel, for a caller that is
 * about to navigate there — an invite link lands on /ping/…, then sends you to
 * the feed with that screening open beside it.
 */
let pending: ShowtimePublic | null = null

/**
 * Open `showtime` in the current page's panel. `false` when the page has no
 * panel, so the caller can go somewhere that does.
 */
export const openInShowtimePanel = (showtime: ShowtimePublic): boolean => {
  if (!opener) return false
  opener(showtime)
  return true
}

/**
 * Open `showtime` in the panel of the page about to be navigated to — or of
 * this one, if it already has a panel. Call it just before navigating.
 */
export const openInShowtimePanelOnArrival = (showtime: ShowtimePublic) => {
  if (opener) {
    opener(showtime)
    return
  }
  pending = showtime
}

/**
 * Offer this page's panel for as long as the page is mounted. `open` must be
 * stable (a `useCallback`), since it is the effect's dependency.
 */
export const useShowtimePanelSlot = (open: OpenShowtime) => {
  useLayoutEffect(() => {
    opener = open
    if (pending) {
      const waiting = pending
      pending = null
      open(waiting)
    }
    return () => {
      if (opener === open) opener = null
    }
  }, [open])
}
