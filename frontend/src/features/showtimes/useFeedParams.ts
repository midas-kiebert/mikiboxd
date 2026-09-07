import { useNavigate, useSearch } from "@tanstack/react-router"
import { DateTime } from "luxon"
/**
 * The URL-state half of a feed, shared by the showtimes feed and the films feed.
 *
 * Both pages filter on the same dimensions — that is deliberate, and it is what
 * `useSharedTabFilters` does in the app — so they read and write the same
 * `FeedParams`. Switching between them carries your filters across, and neither
 * page owns a private copy of the parsing.
 */
import { useCallback, useMemo, useState } from "react"
import { AMSTERDAM_ZONE } from "shared/filters/day-filter-utils"

import {
  type FeedParams,
  countActiveFilters,
  parseFeedParams,
  stripDefaultFeedParams,
} from "./feed-params"

/** Pin "now" for the life of the view so pages cannot drift past each other. */
const buildSnapshotTime = () =>
  DateTime.now().setZone(AMSTERDAM_ZONE).toFormat("yyyy-MM-dd'T'HH:mm:ss")

export const useFeedParams = () => {
  const navigate = useNavigate()
  const rawSearch = useSearch({ strict: false }) as Record<string, unknown>
  const [snapshotTime, setSnapshotTime] = useState(buildSnapshotTime)

  const params = useMemo(() => parseFeedParams(rawSearch), [rawSearch])
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

  /**
   * A refresh has to move the snapshot as well as refetch: leaving it pinned
   * re-fetches the same frozen window and quietly keeps showing screenings that
   * have since started.
   */
  const refresh = useCallback(() => {
    setSnapshotTime(buildSnapshotTime())
  }, [])

  return {
    params,
    setParams,
    resetParams,
    activeFilterCount,
    snapshotTime,
    refresh,
  }
}
