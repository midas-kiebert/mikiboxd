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
  defaultFeedParams,
  parseFeedParams,
  stripDefaultFeedParams,
} from "./feed-params"

/** Puts pinned dimensions back to their defaults, so they are not counted. */
const defaultsForPinned = (pinned?: Partial<FeedParams>) => {
  if (!pinned) return {}
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(pinned) as (keyof FeedParams)[]) {
    out[key] = defaultFeedParams[key]
  }
  return out as Partial<FeedParams>
}

/** Pin "now" for the life of the view so pages cannot drift past each other. */
const buildSnapshotTime = () =>
  DateTime.now().setZone(AMSTERDAM_ZONE).toFormat("yyyy-MM-dd'T'HH:mm:ss")

type UseFeedParamsOptions = {
  /**
   * Dimensions this page fixes and the visitor cannot change — a cinema page is
   * the feed with one cinema pinned, not a second feed. Pinned values win over
   * whatever is in the URL and survive a reset, so "clear filters" clears the
   * visitor's choices without navigating them off the page they are on.
   */
  pinned?: Partial<FeedParams>
}

export const useFeedParams = ({ pinned }: UseFeedParamsOptions = {}) => {
  const navigate = useNavigate()
  const rawSearch = useSearch({ strict: false }) as Record<string, unknown>
  const [snapshotTime, setSnapshotTime] = useState(buildSnapshotTime)

  // `pinned` is a literal at every call site, so compare its content rather
  // than its identity or the feed refetches on every render.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pinned's identity changes every render but JSON.stringify(pinned) is what actually varies
  const params = useMemo(
    () => ({ ...parseFeedParams(rawSearch), ...pinned }),
    [rawSearch, JSON.stringify(pinned)],
  )

  // Pinned dimensions are the page, not a filter the visitor applied, so they
  // do not count towards "clear filters".
  // biome-ignore lint/correctness/useExhaustiveDependencies: pinned's identity changes every render but JSON.stringify(pinned) is what actually varies
  const activeFilterCount = useMemo(
    () => countActiveFilters({ ...params, ...defaultsForPinned(pinned) }),
    [params, JSON.stringify(pinned)],
  )

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
    pinned,
    setParams,
    resetParams,
    activeFilterCount,
    snapshotTime,
    refresh,
  }
}
