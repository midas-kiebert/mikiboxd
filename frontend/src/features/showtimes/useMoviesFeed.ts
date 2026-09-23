/**
 * The films feed, the same shape as `useShowtimesFeed` and over the same URL
 * state — so the two pages share their filters and a screen can be written
 * against either without knowing which it got.
 */
import { useMemo } from "react"
import { useFetchMovies } from "shared/hooks/useFetchMovies"

import { feedParamsToMovieFilters } from "./feed-params"
import { type FeedParamsState, useFeedParams } from "./useFeedParams"

/** Films are taller rows than showtimes, so fewer of them fill a first screen. */
const FIRST_PAGE_LIMIT = 15
const PAGE_LIMIT = 30

type UseMoviesFeedOptions = {
  /** Off when the page is showing the showtimes feed instead. */
  enabled?: boolean
  /**
   * How many of each film's screenings to carry. The API sends five unless
   * asked, and will not send more than ten — enough for a card that names the
   * next one, the ceiling for a card that draws a timetable.
   */
  showtimeLimit?: number
  /** Filter state owned by the page — see `FeedParamsState`. */
  feedState?: FeedParamsState
}

export const useMoviesFeed = ({
  enabled = true,
  showtimeLimit,
  feedState,
}: UseMoviesFeedOptions = {}) => {
  const ownState = useFeedParams()
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
    () => feedParamsToMovieFilters(queryParams),
    [queryParams],
  )

  const query = useFetchMovies({
    limit: PAGE_LIMIT,
    firstPageLimit: FIRST_PAGE_LIMIT,
    showtimeLimit,
    snapshotTime,
    filters,
    enabled,
  })

  const movies = useMemo(() => query.data?.pages.flat() ?? [], [query.data])

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
    movies,
    isLoading: enabled && query.isPending,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: Boolean(query.hasNextPage),
    fetchNextPage: query.fetchNextPage,
    isEmpty: !query.isPending && movies.length === 0,
    isFilteredEmpty:
      !query.isPending &&
      movies.length === 0 &&
      (activeFilterCount > 0 || params.q.trim() !== ""),
  }
}

export type MoviesFeed = ReturnType<typeof useMoviesFeed>
