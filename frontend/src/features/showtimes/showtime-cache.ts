/**
 * Writing one showtime back into every feed that is currently showing it.
 *
 * The website caches showtimes as a handful of infinite queries — the home
 * feed, a cinema's programme, your agenda, a friend's agenda — and one
 * screening can be in several of them at once. Acting on it used to
 * `invalidateQueries(["showtimes"])`, which refetches *every page* of *every*
 * one of those, so pressing "Going" after scrolling a few hundred rows deep
 * re-requested the lot. That is what made the panel feel like it reloaded the
 * page.
 *
 * The server hands the whole updated `ShowtimePublic` back from the very
 * mutation that changed it, so there is nothing to go and ask for: this drops
 * that row into place wherever it already sits.
 *
 * Two rules keep it honest:
 *
 *   - Untouched caches keep their identity. `["showtimes"]` also covers the
 *     per-showtime seat-availability and visibility entries, whose data is not
 *     a page of rows at all, and every feed that does not contain this
 *     screening. Handing any of those a new object would re-render a feed that
 *     did not change.
 *   - Membership is not patchable. A feed whose *contents* depend on the
 *     status — your agenda is the showtimes you said yes to — has to be asked
 *     again, because no local edit can know that a row should now leave. Those
 *     are named in `STATUS_SCOPED_FEED_KEYS` and are short, unlike the feeds
 *     this patches.
 */
import type { QueryClient } from "@tanstack/react-query"
import type { ShowtimePublic } from "shared"

/** Every showtime feed's cache: pages of rows, from `useInfiniteQuery`. */
type ShowtimeFeedData = {
  pages: ShowtimePublic[][]
  pageParams: unknown[]
}

/**
 * The feeds that are a *selection* of showtimes rather than a listing of them,
 * so a status change can add a row to them or take one away. Patching cannot
 * express that; only refetching can.
 */
const STATUS_SCOPED_FEED_KEYS = [
  ["showtimes", "agenda"],
  ["showtimes", "me"],
] as const

const isShowtimeFeedData = (data: unknown): data is ShowtimeFeedData =>
  typeof data === "object" &&
  data !== null &&
  Array.isArray((data as ShowtimeFeedData).pages)

/** A page with the row replaced, or the very same page when it has no such row. */
const patchPage = (
  page: ShowtimePublic[],
  showtimeId: number,
  next: ShowtimePublic,
): ShowtimePublic[] => {
  const index = page.findIndex((showtime) => showtime?.id === showtimeId)
  if (index === -1) return page
  const patched = page.slice()
  patched[index] = next
  return patched
}

/**
 * Put `showtime` into every cached feed that already lists it.
 *
 * Only the caches that actually contain it are rewritten, so this is cheap to
 * call from a mutation that fires on every button press.
 */
export const putShowtimeInFeeds = (
  queryClient: QueryClient,
  showtime: ShowtimePublic,
): void => {
  const entries = queryClient.getQueriesData({ queryKey: ["showtimes"] })

  for (const [queryKey, data] of entries) {
    if (!isShowtimeFeedData(data)) continue

    let changed = false
    const pages = data.pages.map((page) => {
      if (!Array.isArray(page)) return page
      const patched = patchPage(page, showtime.id, showtime)
      if (patched !== page) changed = true
      return patched
    })

    if (!changed) continue
    queryClient.setQueryData(queryKey, { ...data, pages })
  }
}

/**
 * Ask again for the feeds whose membership the viewer's own status decides.
 *
 * Deliberately not `["showtimes"]`: that prefix reaches the home feed, which
 * is the long one, and its rows are the same screenings whatever the viewer
 * said about them.
 */
export const refetchStatusScopedFeeds = (queryClient: QueryClient): void => {
  for (const queryKey of STATUS_SCOPED_FEED_KEYS) {
    queryClient.invalidateQueries({ queryKey })
  }
}
