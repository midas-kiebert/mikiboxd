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
import { useFeedParams } from "./useFeedParams"

/**
 * The first page is the one page everybody loads, and on a filtered feed it is
 * often the only one anyone looks at. Later pages are larger, because by then
 * the visitor is scrolling and a big page is what keeps them away from the
 * loader. Mirrors what the app does.
 */
const FIRST_PAGE_LIMIT = 20
const PAGE_LIMIT = 40

type UseShowtimesFeedOptions = {
  /** Dimensions a page fixes for the visitor — see `useFeedParams`. */
  pinned?: Partial<FeedParams>
  /** Hooks cannot be conditional, so callers running two feeds at once pass this instead. */
  enabled?: boolean
}

export const useShowtimesFeed = ({
  pinned,
  enabled = true,
}: UseShowtimesFeedOptions = {}) => {
  const {
    params,
    setParams,
    resetParams,
    activeFilterCount,
    snapshotTime,
    refresh,
  } = useFeedParams({ pinned })

  const filters = useMemo(() => feedParamsToApiFilters(params), [params])

  const query = useFetchMainPageShowtimes({
    limit: PAGE_LIMIT,
    firstPageLimit: FIRST_PAGE_LIMIT,
    snapshotTime,
    filters,
    enabled,
  })

  const showtimes = useMemo(() => query.data?.pages.flat() ?? [], [query.data])

  return {
    params,
    setParams,
    resetParams,
    activeFilterCount,
    refresh,
    showtimes,
    isLoading: enabled && query.isLoading,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: Boolean(query.hasNextPage),
    fetchNextPage: query.fetchNextPage,
    isEmpty: !query.isLoading && showtimes.length === 0,
    /** True when the feed is empty *because* of a filter, not because the catalogue is. */
    isFilteredEmpty:
      !query.isLoading &&
      showtimes.length === 0 &&
      (activeFilterCount > 0 || params.q.trim() !== ""),
  }
}

export type ShowtimesFeed = ReturnType<typeof useShowtimesFeed>
export { defaultFeedParams }
