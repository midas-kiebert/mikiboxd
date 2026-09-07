/**
 * The two personal showtime feeds — your own agenda, and a friend's — in the
 * same shape as `useShowtimesFeed`, so `ShowtimeFeedPage` can render any of
 * them without knowing which it got.
 *
 * Both endpoints take a narrower filter set than the main feed: your agenda is
 * already scoped to your selections, so `selectedStatuses` is the meaningful
 * one and the language/list dimensions are not offered. Passing a filter the
 * endpoint ignores would put a control on screen that silently does nothing, so
 * each hook passes only what its endpoint accepts.
 */
import { useMemo } from "react"
import { useFetchMyShowtimes } from "shared/hooks/useFetchMyShowtimes"
import { useFetchUserShowtimes } from "shared/hooks/useFetchUserShowtimes"

import { feedParamsToApiFilters } from "./feed-params"
import { useFeedParams } from "./useFeedParams"

const PAGE_LIMIT = 30

/** The dimensions `/me/showtimes` actually filters on. */
const toMyShowtimesFilters = (
  all: ReturnType<typeof feedParamsToApiFilters>,
) => ({
  query: all.query,
  days: all.days,
  selectedCinemaIds: all.selectedCinemaIds,
  timeRanges: all.timeRanges,
  runtimeMin: all.runtimeMin,
  runtimeMax: all.runtimeMax,
  watchlistOnly: all.watchlistOnly,
  selectedStatuses: all.selectedStatuses,
})

export const useMyAgendaFeed = () => {
  const { params, setParams, resetParams, activeFilterCount, snapshotTime, refresh } =
    useFeedParams()

  const filters = useMemo(
    () => toMyShowtimesFilters(feedParamsToApiFilters(params)),
    [params],
  )

  const query = useFetchMyShowtimes({ limit: PAGE_LIMIT, snapshotTime, filters })
  const showtimes = useMemo(() => query.data?.pages.flat() ?? [], [query.data])

  return {
    params,
    setParams,
    resetParams,
    activeFilterCount,
    refresh,
    showtimes,
    isLoading: query.isLoading,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: Boolean(query.hasNextPage),
    fetchNextPage: query.fetchNextPage,
    isEmpty: !query.isLoading && showtimes.length === 0,
    isFilteredEmpty:
      !query.isLoading &&
      showtimes.length === 0 &&
      (activeFilterCount > 0 || params.q.trim() !== ""),
  }
}

export const useFriendAgendaFeed = (userId: string) => {
  const { params, setParams, resetParams, activeFilterCount, snapshotTime, refresh } =
    useFeedParams()

  // This endpoint takes the wider set, minus the main feed's cinema-scope flag.
  const filters = useMemo(() => {
    const { allCinemas: _allCinemas, ...rest } = feedParamsToApiFilters(params)
    return rest
  }, [params])

  const query = useFetchUserShowtimes({
    limit: PAGE_LIMIT,
    snapshotTime,
    userId,
    filters,
  })
  const showtimes = useMemo(() => query.data?.pages.flat() ?? [], [query.data])

  return {
    params,
    setParams,
    resetParams,
    activeFilterCount,
    refresh,
    showtimes,
    isLoading: query.isLoading,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: Boolean(query.hasNextPage),
    fetchNextPage: query.fetchNextPage,
    isEmpty: !query.isLoading && showtimes.length === 0,
    isFilteredEmpty:
      !query.isLoading &&
      showtimes.length === 0 &&
      (activeFilterCount > 0 || params.q.trim() !== ""),
  }
}
