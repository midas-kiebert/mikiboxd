/**
 * The films feed, the same shape as `useShowtimesFeed` and over the same URL
 * state — so the two pages share their filters and a screen can be written
 * against either without knowing which it got.
 */
import { useMemo } from "react"
import { useFetchMovies } from "shared/hooks/useFetchMovies"

import { feedParamsToMovieFilters } from "./feed-params"
import { useFeedParams } from "./useFeedParams"

/** Films are taller rows than showtimes, so fewer of them fill a first screen. */
const FIRST_PAGE_LIMIT = 15
const PAGE_LIMIT = 30

export const useMoviesFeed = () => {
  const {
    params,
    setParams,
    resetParams,
    activeFilterCount,
    snapshotTime,
    refresh,
  } = useFeedParams()

  const filters = useMemo(() => feedParamsToMovieFilters(params), [params])

  const query = useFetchMovies({
    limit: PAGE_LIMIT,
    firstPageLimit: FIRST_PAGE_LIMIT,
    snapshotTime,
    filters,
  })

  const movies = useMemo(() => query.data?.pages.flat() ?? [], [query.data])

  return {
    params,
    setParams,
    resetParams,
    activeFilterCount,
    refresh,
    movies,
    isLoading: query.isLoading,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: Boolean(query.hasNextPage),
    fetchNextPage: query.fetchNextPage,
    isEmpty: !query.isLoading && movies.length === 0,
    isFilteredEmpty:
      !query.isLoading &&
      movies.length === 0 &&
      (activeFilterCount > 0 || params.q.trim() !== ""),
  }
}

export type MoviesFeed = ReturnType<typeof useMoviesFeed>
