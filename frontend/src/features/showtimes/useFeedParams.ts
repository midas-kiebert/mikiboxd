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
import { useCallback, useMemo, useRef, useState } from "react"
import { AMSTERDAM_ZONE } from "shared/filters/day-filter-utils"

import { useIsSignedIn } from "@/auth/useSession"
import { usePreferredCinemaIds } from "@/features/showtimes/guest-preferred-cinemas"

import {
  type FeedParams,
  countActiveFilters,
  defaultFeedParams,
  parseFeedParams,
  stripDefaultFeedParams,
} from "./feed-params"
import { useOptimisticFeedParams } from "./use-optimistic-feed-params"

/**
 * What the feed's *results* depend on, as one comparable string.
 *
 * Search is left out on purpose. It is uncommitted keystrokes: every letter
 * patches `q`, and a feed that blanked itself under each one would read far
 * worse than one that narrows as you type. Every other dimension replaces the
 * result set wholesale, which is what the loading screen is for.
 */
const filterIdentity = (params: FeedParams): string =>
  JSON.stringify(
    (Object.keys(params) as (keyof FeedParams)[])
      .filter((key) => key !== "q")
      .sort()
      .map((key) => [key, params[key]]),
  )

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
export const buildSnapshotTime = () =>
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

/**
 * One feed's filter state. A page running two feeds over the same URL (the
 * home feed's screenings and its "one row per film" mode) makes one of these
 * and hands it to both, so they and the page share a single optimistic copy.
 */
export type FeedParamsState = ReturnType<typeof useFeedParams>

export const useFeedParams = ({ pinned }: UseFeedParamsOptions = {}) => {
  const navigate = useNavigate()
  const rawSearch = useSearch({ strict: false }) as Record<string, unknown>
  const [snapshotTime, setSnapshotTime] = useState(buildSnapshotTime)

  // `pinned` is a literal at every call site, so compare its content rather
  // than its identity or the feed refetches on every render.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pinned's identity changes every render but JSON.stringify(pinned) is what actually varies
  const committedParams = useMemo(
    () => ({ ...parseFeedParams(rawSearch), ...pinned }),
    [rawSearch, JSON.stringify(pinned)],
  )

  // Your own cinemas (the account's, or a guest's in this browser), so that
  // sitting on them does not read as a filter the visitor applied (see
  // `countActiveFilters`). Cached under the same key the rail's picker reads.
  const { data: preferredCinemaIds } = usePreferredCinemaIds()

  /**
   * The URL write, which the overlay below hands the change over to once the
   * press has been answered. It is bookkeeping for deep links and the back
   * button — nothing on screen waits for it.
   */
  const commitParams = useCallback(
    (patch: Partial<FeedParams>) => {
      void navigate({
        to: ".",
        search: stripDefaultFeedParams({
          ...committedParams,
          ...patch,
        }) as never,
        replace: true,
      })
    },
    [navigate, committedParams],
  )

  /**
   * What the visitor has chosen, which runs ahead of what the URL says.
   *
   * Writing to the URL is the slow half of a filter change — the router
   * re-renders the route around it — so the write is deferred past the frame
   * that answers the press, and this overlay is what everything reads in the
   * meantime: the rail's controls, the active-filter count, *and* the query
   * behind the rows. Keying the query on the URL instead used to leave the
   * request unsent for the 300-500ms the navigation took, with a spinner up
   * and nothing in flight behind it.
   */
  const { params, onChange: setParams } = useOptimisticFeedParams(
    committedParams,
    commitParams,
  )

  // Pinned dimensions are the page, not a filter the visitor applied, so they
  // do not count towards "clear filters".
  // biome-ignore lint/correctness/useExhaustiveDependencies: pinned's identity changes every render but JSON.stringify(pinned) is what actually varies
  const activeFilterCount = useMemo(
    () =>
      countActiveFilters(
        { ...params, ...defaultsForPinned(pinned) },
        preferredCinemaIds,
      ),
    [params, preferredCinemaIds, JSON.stringify(pinned)],
  )

  /**
   * Whether the last change to the filters was only to the search text.
   *
   * Typing is not a filter: each letter is its own uncached query, and a feed
   * that emptied itself under every one would read far worse than one that
   * narrows as you type. So a load that follows a keystroke keeps the rows it
   * has, where a load that follows a filter replaces them.
   *
   * Tracked by comparing against the params the *previous* URL held, during
   * render and idempotently, because the answer is needed in the same render
   * the new params arrive in — an effect would be a frame late, which is a
   * frame of wrongly blanked feed.
   */
  /**
   * What the rows should reflect: everything the visitor has flicked, taken
   * from the overlay so the feed moves with the press — but the search text
   * as the URL holds it, which is the same text a beat after the typing
   * stopped (`SEARCH_DEBOUNCE_MS`). Keying the query on the letter just typed
   * instead meant a request, and a whole new result set, per keystroke.
   */
  // What is sent. An empty cinema list means "my cinemas", which the server
  // resolves from the account; a guest's are only in this browser, so they
  // are spelled out, or a guest's feed would cover every cinema.
  const isSignedIn = useIsSignedIn()
  const queryParams = useMemo(() => {
    const guestCinemas =
      !isSignedIn && !params.allCinemas && params.cinemas.length === 0
        ? preferredCinemaIds
        : undefined
    return {
      ...params,
      q: committedParams.q,
      ...(guestCinemas?.length ? { cinemas: guestCinemas } : {}),
    }
  }, [params, committedParams.q, isSignedIn, preferredCinemaIds])

  const filtersKey = useMemo(() => filterIdentity(params), [params])
  const lastParamsRef = useRef(params)
  const filtersBeforeRef = useRef(filtersKey)
  if (lastParamsRef.current !== params) {
    filtersBeforeRef.current = filterIdentity(lastParamsRef.current)
    lastParamsRef.current = params
  }
  const isSearchOnlyLoad = filtersBeforeRef.current === filtersKey

  const resetParams = useCallback(() => {
    setParams({ ...defaultFeedParams, ...pinned })
    // biome-ignore lint/correctness/useExhaustiveDependencies: pinned's identity changes every render but its content is what matters
  }, [setParams, JSON.stringify(pinned)])

  /**
   * Put a whole set of filters on at once, the way a quick filter does:
   * every dimension `next` carries replaces the visitor's, and only what the
   * page itself pins survives it. The feed overview's "Show more" is this.
   */
  const applyParams = useCallback(
    (next: FeedParams) => {
      setParams({ ...next, ...pinned })
    },
    // biome-ignore lint/correctness/useExhaustiveDependencies: pinned's identity changes every render but its content is what matters
    [setParams, JSON.stringify(pinned)],
  )

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
    applyParams,
    activeFilterCount,
    snapshotTime,
    refresh,
    queryParams,
    isSearchOnlyLoad,
    /**
     * Which filters the feed's rows belong to. Rows carrying a different one
     * are the previous filter's and must not be painted — see
     * `ShowtimeFeedPage`, where a deferred copy of the list can lag behind a
     * filter change by a frame or two.
     */
    filtersKey,
  }
}
