/**
 * The feed overview's data: the short lists beside the feed while nothing is
 * selected, as the server picked them (`GET /me/feed-overview`).
 *
 * Asked of the server rather than read off the feed's loaded rows, so the card
 * stays put while the feed scrolls under it. Which lists appear, in what
 * order and how many rows each gets is decided there — see the backend's
 * `services/feed_overview.py` — so this only says what the feed is showing
 * right now (its language and cinemas, which two of the lists follow) and what
 * the viewer's own list is.
 *
 * **The viewer's own list** ("custom" on the wire) is a set of filters they
 * chose for the card: one of their saved presets, followed live so editing
 * the preset edits the list, or a snapshot of the filters that were on when
 * they picked "Use these filters". Kept on this device, in `localStorage`,
 * like the remembered language (`use-remembered-language`): the account has
 * nowhere to store it yet.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback, useMemo, useRef, useState } from "react"
import type { ShowtimePublic } from "shared"
import { type FeedOverviewSectionKind, MeService } from "shared/client"
import type { DisplayPreset } from "shared/filters/saved-presets"
import { useDisplayPresets } from "shared/filters/useDisplayPresets"
import useAuth from "shared/hooks/useAuth"
import { seedShowtimeSeatAvailability } from "shared/hooks/useShowtimeSeatAvailability"
import { seedShowtimeVisibility } from "shared/hooks/useShowtimeVisibility"

import {
  type FeedParams,
  defaultFeedParams,
  feedParamsToApiFilters,
} from "./feed-params"
import { presetPatchForFeed } from "./feed-presets"
import { readRememberedLanguages } from "./use-remembered-language"

const STORAGE_KEY = "mikino.overview.custom-list.v1"

/**
 * How long the card's lists are reused before being asked for again. Long
 * enough that flicking a filter back and forth does not refetch it; the
 * viewer's own status changes refetch it regardless (`showtime-cache`).
 */
const OVERVIEW_REUSABLE_FOR_MS = 60_000

/** What the viewer picked for their own list. */
export type CustomListChoice =
  | { kind: "preset"; presetId: string }
  | { kind: "filters"; params: FeedParams }

/** A custom list, resolved to something the card can ask for and name. */
export type CustomList = {
  choice: CustomListChoice
  title: string
  params: FeedParams
}

const readChoice = (): CustomListChoice | null => {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null")
    if (stored?.kind === "preset" && typeof stored.presetId === "string") {
      return { kind: "preset", presetId: stored.presetId }
    }
    if (stored?.kind === "filters" && stored.params) {
      return {
        kind: "filters",
        params: { ...defaultFeedParams, ...stored.params },
      }
    }
  } catch {
    // ignore storage read errors
  }
  return null
}

const writeChoice = (choice: CustomListChoice | null) => {
  try {
    if (choice) localStorage.setItem(STORAGE_KEY, JSON.stringify(choice))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore storage write errors
  }
}

/** Filters from scratch plus a preset's, the way applying it to a clean feed would. */
const presetParams = (
  preset: DisplayPreset,
  hasLetterboxdUsername: boolean,
): FeedParams => ({
  ...defaultFeedParams,
  ...presetPatchForFeed(preset, defaultFeedParams, hasLetterboxdUsername),
})

/**
 * A list is usually partial — a preset that says nothing about language, a
 * snapshot taken with no cinemas picked — and every dimension it leaves unset
 * takes the viewer's own default, exactly as a fresh feed would: the
 * remembered language (`use-remembered-language`), and for cinemas the
 * account's usual ones, which is what the server already reads an empty
 * selection as. The rest have no default beyond "no filter".
 */
const withViewerDefaults = (params: FeedParams): FeedParams =>
  params.languages.length
    ? params
    : { ...params, languages: readRememberedLanguages() }

/** The label a "Use these filters" list carries. */
export const CURRENT_FILTERS_TITLE = "Your filters"

const useCustomList = (enabled: boolean) => {
  const { user } = useAuth()
  const hasLetterboxdUsername = Boolean(user?.letterboxd_username?.trim())
  const { presets } = useDisplayPresets({ enabled })
  const [choice, setChoiceState] = useState<CustomListChoice | null>(readChoice)

  const setChoice = useCallback((next: CustomListChoice | null) => {
    setChoiceState(next)
    writeChoice(next)
  }, [])

  const list = useMemo((): CustomList | null => {
    if (!choice) return null
    if (choice.kind === "filters") {
      return {
        choice,
        title: CURRENT_FILTERS_TITLE,
        params: withViewerDefaults(choice.params),
      }
    }
    // A preset that has since been deleted takes the list with it.
    const preset = presets.find((entry) => entry.id === choice.presetId)
    if (!preset) return null
    return {
      choice,
      title: preset.name,
      params: withViewerDefaults(presetParams(preset, hasLetterboxdUsername)),
    }
  }, [choice, presets, hasLetterboxdUsername])

  return useMemo(
    () => ({ list, presets, setChoice }),
    [list, presets, setChoice],
  )
}

export type FeedOverviewSection = {
  kind: FeedOverviewSectionKind
  showtimes: ShowtimePublic[]
}

type UseFeedOverviewOptions = {
  /** The feed's own filters; the friends and watchlist lists follow its language and cinemas. */
  feedParams: FeedParams
  /** Signed in, and on a screen wide enough to show the card. */
  enabled: boolean
  /**
   * Hold the lists as they are. While a showtime picked from the card is open
   * in the panel, the card is out of sight, and answering that showtime would
   * otherwise refetch it out from under the selection.
   */
  paused: boolean
}

const NO_SECTIONS: FeedOverviewSection[] = []

/**
 * Where "Show more" goes for a list: the filters on the feed that come
 * closest to it. None for invites and "selling fast", which no filter
 * describes.
 */
export type ShowMoreTarget = { kind: "filters"; params: FeedParams }

export const showMoreTarget = (
  kind: FeedOverviewSectionKind,
  feedParams: FeedParams,
  customList: CustomList | null,
): ShowMoreTarget | null => {
  // The language the card itself was asked for; a list stays in it. So does
  // the layout: flipping between the ticket wall and film rows rebuilds the
  // whole page, rail and all, which is not what "show more" asks for.
  const base: FeedParams = {
    ...defaultFeedParams,
    languages: feedParams.languages,
    group: feedParams.group,
  }
  switch (kind) {
    case "invited":
      return null
    case "plans":
      return {
        kind: "filters",
        params: { ...base, mine: true, status: "interested" },
      }
    case "custom":
      return customList
        ? {
            kind: "filters",
            params: { ...customList.params, group: feedParams.group },
          }
        : null
    // No filter narrows the feed to what is selling fast, so there is no
    // "more" to show.
    case "selling_fast":
      return null
    case "friends_going":
      // Friends go everywhere, so the section never narrowed to your cinemas.
      return {
        kind: "filters",
        params: { ...base, status: "interested", allCinemas: true },
      }
    case "watchlist":
      return {
        kind: "filters",
        params: {
          ...base,
          cinemas: feedParams.cinemas,
          allCinemas: feedParams.allCinemas,
          watchlist: "only",
        },
      }
  }
}

type OverviewScope = {
  overviewLanguages: FeedParams["languages"] | undefined
  overviewCinemaIds: FeedParams["cinemas"] | undefined
  overviewAllCinemas: true | undefined
}

/** The part of the feed's filters the card itself follows. */
const overviewScope = (params: FeedParams): OverviewScope => ({
  overviewLanguages: params.languages.length ? params.languages : undefined,
  overviewCinemaIds: params.cinemas.length ? params.cinemas : undefined,
  overviewAllCinemas: params.allCinemas || undefined,
})

const scopeKey = (scope: OverviewScope) => JSON.stringify(scope)

export const useFeedOverview = ({
  feedParams,
  enabled,
  paused,
}: UseFeedOverviewOptions) => {
  const queryClient = useQueryClient()
  const customList = useCustomList(enabled)

  // "Show more" puts filters on the feed, which moves the language and cinemas
  // the card follows. Asking again would redraw its lists (friends going is a
  // random draw) and swap every poster under the viewer's pointer, so the card
  // keeps the scope it had until the feed moves on to something else.
  const { languages, cinemas, allCinemas } = feedParams
  const liveScope = useMemo(
    () =>
      overviewScope({ ...defaultFeedParams, languages, cinemas, allCinemas }),
    [languages, cinemas, allCinemas],
  )
  const [held, setHeld] = useState<{
    scope: OverviewScope
    key: string
  } | null>(null)
  const scope =
    held && held.key === scopeKey(liveScope) ? held.scope : liveScope
  const shownScopeRef = useRef(scope)
  shownScopeRef.current = scope
  const holdForShowMore = useCallback((next: FeedParams) => {
    setHeld({
      scope: shownScopeRef.current,
      key: scopeKey(overviewScope(next)),
    })
  }, [])

  const request = useMemo(() => {
    const custom = customList.list
      ? feedParamsToApiFilters(customList.list.params)
      : null
    return { ...scope, includeCustom: custom !== null, ...custom }
  }, [customList.list, scope])

  const query = useQuery({
    queryKey: ["showtimes", "overview", request],
    queryFn: async () => {
      const overview = await MeService.getFeedOverview(request)
      const showtimes = overview.sections.flatMap(
        (section) => section.showtimes,
      )
      // As every feed does: the badges read these caches, so the rows paint
      // with them rather than a request later.
      seedShowtimeSeatAvailability(queryClient, showtimes)
      seedShowtimeVisibility(queryClient, showtimes)
      return overview
    },
    enabled: enabled && !paused,
    // Keeps the last lists up while a new language or cinema set is asked for,
    // rather than blanking the card between them.
    placeholderData: (previous) => previous,
    staleTime: OVERVIEW_REUSABLE_FOR_MS,
    refetchOnWindowFocus: false,
  })

  const sections = query.data?.sections ?? NO_SECTIONS
  const showtimes = useMemo(
    () => sections.flatMap((section) => section.showtimes),
    [sections],
  )

  const isPending = enabled && query.isPending
  // One object for as long as nothing in it changes: the panel it feeds is
  // memoised, and the page re-renders on every click.
  return useMemo(
    () => ({
      sections,
      /** Every row on the card, for resolving a selection made from it. */
      showtimes,
      isPending,
      customList,
      holdForShowMore,
    }),
    [sections, showtimes, isPending, customList, holdForShowMore],
  )
}

export type FeedOverview = ReturnType<typeof useFeedOverview>
