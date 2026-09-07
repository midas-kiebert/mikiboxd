import { useNavigate, useSearch } from "@tanstack/react-router"
import { DateTime } from "luxon"
/**
 * The showtimes feed, as one hook: URL state in, paged showtimes out.
 *
 * Everything a feed screen needs comes from here, so the components below it can
 * be rearranged, restyled or replaced without touching data or state. That is
 * the point of the split — the layout is expected to change repeatedly, and this
 * file should not have to change with it.
 */
import { useCallback, useMemo, useState } from "react"
import { AMSTERDAM_ZONE } from "shared/filters/day-filter-utils"
import { useFetchMainPageShowtimes } from "shared/hooks/useFetchMainPageShowtimes"

import {
  type FeedParams,
  countActiveFilters,
  defaultFeedParams,
  feedParamsToApiFilters,
  parseFeedParams,
  stripDefaultFeedParams,
} from "./feed-params"

/**
 * The first page is the one page everybody loads, and on a filtered feed it is
 * often the only one anyone looks at. Later pages are larger, because by then
 * the visitor is scrolling and a big page is what keeps them away from the
 * loader. Mirrors what the app does.
 */
const FIRST_PAGE_LIMIT = 20
const PAGE_LIMIT = 40

/** Pin "now" for the life of the view so pages cannot drift past each other. */
const buildSnapshotTime = () =>
  DateTime.now().setZone(AMSTERDAM_ZONE).toFormat("yyyy-MM-dd'T'HH:mm:ss")

export const useShowtimesFeed = () => {
  const navigate = useNavigate()
  const rawSearch = useSearch({ strict: false }) as Record<string, unknown>
  const [snapshotTime, setSnapshotTime] = useState(buildSnapshotTime)

  const params = useMemo(() => parseFeedParams(rawSearch), [rawSearch])
  const filters = useMemo(() => feedParamsToApiFilters(params), [params])
  const activeFilterCount = useMemo(() => countActiveFilters(params), [params])

  /** Patch one or more dimensions; everything else keeps its current value. */
  const setParams = useCallback(
    (patch: Partial<FeedParams>) => {
      const next = { ...params, ...patch }
      void navigate({
        to: ".",
        search: stripDefaultFeedParams(next) as never,
        replace: true,
      })
    },
    [navigate, params],
  )

  const resetParams = useCallback(() => {
    void navigate({ to: ".", search: {} as never, replace: true })
  }, [navigate])

  const query = useFetchMainPageShowtimes({
    limit: PAGE_LIMIT,
    firstPageLimit: FIRST_PAGE_LIMIT,
    snapshotTime,
    filters,
  })

  /**
   * A refresh has to move the snapshot as well as refetch: leaving it pinned
   * re-fetches the same frozen window and quietly keeps showing showtimes that
   * have since started.
   */
  const refresh = useCallback(() => {
    setSnapshotTime(buildSnapshotTime())
  }, [])

  const showtimes = useMemo(() => query.data?.pages.flat() ?? [], [query.data])

  return {
    params,
    setParams,
    resetParams,
    activeFilterCount,
    showtimes,
    isLoading: query.isLoading,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: Boolean(query.hasNextPage),
    fetchNextPage: query.fetchNextPage,
    refresh,
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
