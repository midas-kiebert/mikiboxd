/**
 * The showtimes feed, as one hook: URL state in, paged showtimes out.
 *
 * Everything a feed screen needs comes from here, so the components below it can
 * be rearranged, restyled or replaced without touching data or state. That is
 * the point of the split — the layout is expected to change repeatedly, and this
 * file should not have to change with it.
 */
import { useMemo } from "react"
import { useFetchMainPageShowtimes } from "shared/hooks/useFetchMainPageShowtimes"

import {
  type FeedParams,
  defaultFeedParams,
  feedParamsToApiFilters,
} from "./feed-params"
import { type FeedParamsState, useFeedParams } from "./useFeedParams"

/**
 * The first page is the one page everybody loads, and on a filtered feed it is
 * often the only one anyone looks at. Later pages are larger, because by then
 * the visitor is scrolling and a big page is what keeps them away from the
 * loader. Mirrors what the app does.
 */
const FIRST_PAGE_LIMIT = 20
const PAGE_LIMIT = 40

/**
 * How long a filter combination's rows are reused before being fetched again.
 *
 * Filters here are switches, and flicking one back is common enough that
 * re-requesting a set fetched seconds ago was the difference between the feed
 * answering instantly and it putting a loading screen in front of rows it
 * already had. The films feed already keeps its rows for five minutes; a
 * screening's friends and seats move faster than a film's, so this is short.
 */
const ROWS_REUSABLE_FOR_MS = 30_000

type UseShowtimesFeedOptions = {
  /** Dimensions a page fixes for the visitor — see `useFeedParams`. */
  pinned?: Partial<FeedParams>
  /** Hooks cannot be conditional, so callers running two feeds at once pass this instead. */
  enabled?: boolean
  /**
   * Filter state owned by the page, for a page that runs this beside another
   * feed — see `FeedParamsState`. Without it the feed keeps its own.
   */
  feedState?: FeedParamsState
}

export const useShowtimesFeed = ({
  pinned,
  enabled = true,
  feedState,
}: UseShowtimesFeedOptions = {}) => {
  const ownState = useFeedParams({ pinned })
  const {
    params,
    setParams,
    resetParams,
    applyParams,
    activeFilterCount,
    snapshotTime,
    refresh,
    isSearchOnlyLoad,
    filtersKey,
    queryParams,
  } = feedState ?? ownState

  // Keyed on what the visitor has chosen, which runs ahead of the URL: the
  // navigation that records it takes 300-500ms, and waiting for that left the
  // request unsent with a spinner already up. See `useFeedParams`.
  const filters = useMemo(
    () => feedParamsToApiFilters(queryParams),
    [queryParams],
  )

  const query = useFetchMainPageShowtimes({
    limit: PAGE_LIMIT,
    firstPageLimit: FIRST_PAGE_LIMIT,
    snapshotTime,
    filters,
    enabled,
    staleTime: ROWS_REUSABLE_FOR_MS,
  })

  const showtimes = useMemo(() => query.data?.pages.flat() ?? [], [query.data])

  return {
    params,
    setParams,
    resetParams,
    applyParams,
    activeFilterCount,
    refresh,
    filtersKey,
    /**
     * The rows on screen no longer belong to the filters in force, so the
     * page shows its loading screen instead of them. True from the press
     * itself (the URL write lags it on purpose) and on through the fetch it
     * causes — but not for a load that only the search text triggered, which
     * keeps the rows it has rather than blanking under every letter.
     */
    isReplacingRows: query.isPending && !isSearchOnlyLoad,
    showtimes,
    // `isPending` ("nothing to show yet"), not `isLoading` ("a request is in
    // flight"): between a filter changing the query's key and the request for
    // it actually starting, `isLoading` goes false for a frame or two with no
    // data behind it, which blanked the feed with neither rows nor spinner.
    isLoading: enabled && query.isPending,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: Boolean(query.hasNextPage),
    fetchNextPage: query.fetchNextPage,
    isEmpty: !query.isPending && showtimes.length === 0,
    /** True when the feed is empty *because* of a filter, not because the catalogue is. */
    isFilteredEmpty:
      !query.isPending &&
      showtimes.length === 0 &&
      (activeFilterCount > 0 || params.q.trim() !== ""),
  }
}

export type ShowtimesFeed = ReturnType<typeof useShowtimesFeed>
export { defaultFeedParams }
