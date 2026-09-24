/**
 * Every filter dimension the showtimes feed has, in one place.
 *
 * This is the file to edit when a dimension is added or its URL spelling
 * changes — the toolbar, the (still to be built) filter rail and the query all
 * read the same `FeedParams`, so none of them needs to know how a day token is
 * spelled or which API argument a runtime range becomes.
 *
 * The full set is declared here even though Phase 1 only builds controls for a
 * few of them. The shared feed hook already accepts all of it, so a dimension
 * with no UI yet still works if you type it into the URL, and building its
 * control later is UI work with no plumbing behind it.
 *
 * State lives in the URL rather than in React. On a phone that would be
 * pointless ceremony, but on the web it is most of what makes a filtered view
 * useful: it is linkable, it survives a refresh, and back/forward step through
 * filter changes for free.
 */
import type { SearchSchemaInput } from "@tanstack/react-router"
import type { GoingStatus, Language, SearchField } from "shared/client"
import { isCinemaSelectionDifferentFromPreferred } from "shared/filters/cinema-selection"
import { resolveDaySelectionsForApi } from "shared/filters/day-filter-utils"
import { getRuntimeBoundsFromSelections } from "shared/filters/runtime-range-utils"
import {
  type SharedTabShowtimeFilter,
  getSelectedStatusesFromShowtimeFilter,
  toSharedTabShowtimeFilter,
} from "shared/filters/shared-tab-filters"

/** How the watchlist dimension is filtering, if at all. */
export type WatchlistMode = "any" | "only" | "exclude"
/** How the watched dimension is filtering, if at all. */
export type WatchedMode = "any" | "only" | "hide"

export type FeedParams = {
  /** Free-text search. */
  q: string
  /** Which attribute `q` is matched against. */
  field: SearchField
  /** Day tokens — `relative:today`, `weekday:5`, or a literal ISO date. */
  days: string[]
  /** Cinema ids. Empty means "whatever the account's usual cinemas are". */
  cinemas: number[]
  /** Ignore the account's usual cinemas and search everywhere. */
  allCinemas: boolean
  /** Time-of-day range tokens. */
  times: string[]
  /** Runtime range tokens. */
  runtime: string[]
  /**
   * Going / interested marks to narrow to — friends' and your own, or with
   * `mine` only your own.
   */
  status: SharedTabShowtimeFilter
  /**
   * Only your own marks: your agenda, as a filter on the one feed rather than
   * a page of its own. With `status` at "all" it means everything you marked.
   */
  mine: boolean
  /**
   * Only these friends' plans (user ids). One friend is that friend's agenda —
   * the page it used to be, header and all (`Feed/FeedSubjectHeader`). Wins
   * over `mine`.
   */
  friends: string[]
  /** Collapse a movie's showtimes into one row. */
  group: boolean
  watchlist: WatchlistMode
  watched: WatchedMode
  /** Letterboxd list ids to include / exclude. */
  lists: string[]
  excludeLists: string[]
  languages: Language[]
}

export const defaultFeedParams: FeedParams = {
  q: "",
  field: "title",
  days: [],
  cinemas: [],
  allCinemas: false,
  times: [],
  runtime: [],
  status: "all",
  mine: false,
  friends: [],
  group: false,
  watchlist: "any",
  watched: "any",
  lists: [],
  excludeLists: [],
  languages: [],
}

const SEARCH_FIELDS: SearchField[] = [
  "title",
  "director",
  "actor",
  "cinema",
  "friend",
]
const LANGUAGES: Language[] = ["nl", "en"]

/** A URL carries `?days=a&days=b` as a string when there is only one of them. */
const toStringArray = (value: unknown): string[] => {
  if (value === undefined || value === null || value === "") return []
  if (Array.isArray(value)) return value.map(String).filter(Boolean)
  return [String(value)]
}

const toNumberArray = (value: unknown): number[] =>
  toStringArray(value)
    .map((entry) => Number.parseInt(entry, 10))
    .filter((entry) => Number.isFinite(entry))

const toBoolean = (value: unknown): boolean =>
  value === true || value === "true"

const oneOf = <T extends string>(
  value: unknown,
  allowed: T[],
  fallback: T,
): T => (allowed.includes(value as T) ? (value as T) : fallback)

/**
 * What a link to a feed route may pass: any subset of the params, since
 * `parseFeedParams` fills in the rest. Typing `validateSearch`'s argument with
 * this (rather than `Record<string, unknown>`) is what keeps the router from
 * demanding every param on every `<Link>`.
 */
export type FeedSearchInput = Partial<FeedParams> & SearchSchemaInput

/**
 * The route's `validateSearch`. Anything unrecognised falls back to its default
 * rather than throwing, so a hand-edited or stale URL degrades to a working
 * feed instead of an error page.
 */
export const parseFeedParams = (
  search: Record<string, unknown>,
): FeedParams => ({
  q: typeof search.q === "string" ? search.q : defaultFeedParams.q,
  field: oneOf(search.field, SEARCH_FIELDS, defaultFeedParams.field),
  days: toStringArray(search.days),
  cinemas: toNumberArray(search.cinemas),
  allCinemas: toBoolean(search.allCinemas),
  times: toStringArray(search.times),
  runtime: toStringArray(search.runtime),
  status: toSharedTabShowtimeFilter(search.status as SharedTabShowtimeFilter),
  mine: toBoolean(search.mine),
  friends: toStringArray(search.friends),
  group: toBoolean(search.group),
  watchlist: oneOf<WatchlistMode>(
    search.watchlist,
    ["any", "only", "exclude"],
    defaultFeedParams.watchlist,
  ),
  watched: oneOf<WatchedMode>(
    search.watched,
    ["any", "only", "hide"],
    defaultFeedParams.watched,
  ),
  lists: toStringArray(search.lists),
  excludeLists: toStringArray(search.excludeLists),
  languages: toStringArray(search.languages).filter(
    (entry): entry is Language => LANGUAGES.includes(entry as Language),
  ),
})

/**
 * Drop anything still at its default before it reaches the URL, so a feed with
 * no filters on it has a clean address and two equivalent views share one link.
 */
export const stripDefaultFeedParams = (
  params: FeedParams,
): Partial<FeedParams> => {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(params) as (keyof FeedParams)[]) {
    const value = params[key]
    const fallback = defaultFeedParams[key]
    if (Array.isArray(value)) {
      if (value.length > 0) out[key] = value
    } else if (value !== fallback) {
      out[key] = value
    }
  }
  return out as Partial<FeedParams>
}

/**
 * A link's `search` for the home feed narrowed to one friend — what their
 * agenda page used to be. Links go here rather than to that page, which only
 * redirects now; see `Feed/FeedSubjectHeader`.
 */
export const friendFeedSearch = (userId: string): Partial<FeedParams> => ({
  friends: [userId],
})

/** The same for one cinema: its programme, as the cinema page used to show it. */
export const cinemaFeedSearch = (cinemaId: number): Partial<FeedParams> => ({
  cinemas: [cinemaId],
})

/**
 * True when anything other than the free-text search is narrowing the feed.
 *
 * `preferredCinemaIds` is the account's own cinemas. Sitting on those is the
 * resting state rather than a filter, and the website writes them into the URL
 * the moment a chip is touched, so without them every visitor who changes one
 * cinema would be told they have a cinema filter on *and* one they never set.
 * The rule is the app's — see `isCinemaSelectionDifferentFromPreferred`.
 */
export const countActiveFilters = (
  params: FeedParams,
  preferredCinemaIds?: readonly number[],
): number => {
  let count = 0
  if (params.days.length) count += 1
  // Without the account's cinemas to compare against — signed out, or the
  // query has not landed — there is no resting state to be away from, so any
  // explicit selection counts, which is where this started.
  const cinemasAreFiltering =
    preferredCinemaIds === undefined
      ? params.cinemas.length > 0
      : isCinemaSelectionDifferentFromPreferred({
          sessionCinemaIds: params.cinemas.length ? params.cinemas : undefined,
          preferredCinemaIds,
        })
  if (cinemasAreFiltering) count += 1
  // Counted separately from a cinema selection: it is not one, it is the
  // override that ignores the account's usual cinemas, and it can be the only
  // thing narrowing (widening, really) the feed.
  if (params.allCinemas) count += 1
  if (params.times.length) count += 1
  if (params.runtime.length) count += 1
  if (params.status !== "all" || params.mine) count += 1
  if (params.friends.length) count += 1
  if (params.watchlist !== "any") count += 1
  if (params.watched !== "any") count += 1
  if (params.lists.length || params.excludeLists.length) count += 1
  if (params.languages.length) count += 1
  return count
}

/**
 * The dimensions that choose *films* rather than screenings — whether a film
 * is on your watchlist, seen, on a list, or the right length, and the search
 * text — at their defaults. A page about one film pins these (`useFeedParams`'s
 * `pinned`): the film is already chosen, so all they could do is hide its whole
 * run. What is left narrows the screenings: cinemas, language, days, time of
 * day, and whose plans.
 */
export const FILM_LEVEL_FEED_PARAMS: Partial<FeedParams> = {
  q: defaultFeedParams.q,
  field: defaultFeedParams.field,
  allCinemas: defaultFeedParams.allCinemas,
  runtime: defaultFeedParams.runtime,
  group: defaultFeedParams.group,
  watchlist: defaultFeedParams.watchlist,
  watched: defaultFeedParams.watched,
  lists: defaultFeedParams.lists,
  excludeLists: defaultFeedParams.excludeLists,
}

/**
 * The shared feed hook's filter argument. Everything platform-specific about a
 * dimension — how a day token becomes a date, how a runtime token becomes a
 * min/max pair — is resolved by the hoisted `shared/filters` helpers, which is
 * the same code the app runs.
 */
export const feedParamsToApiFilters = (params: FeedParams) => {
  const { runtimeMin, runtimeMax } = getRuntimeBoundsFromSelections(
    params.runtime,
  )
  // "Only mine" with no status picked is everything you marked, which is what
  // "interested" already means (going counts as interested too).
  const selectedStatuses: GoingStatus[] | undefined =
    getSelectedStatusesFromShowtimeFilter(
      params.mine && params.status === "all" ? "interested" : params.status,
    )

  return {
    query: params.q.trim() || undefined,
    searchField: params.field,
    days: params.days.length
      ? resolveDaySelectionsForApi(params.days)
      : undefined,
    selectedCinemaIds: params.cinemas.length ? params.cinemas : undefined,
    allCinemas: params.allCinemas || undefined,
    timeRanges: params.times.length ? params.times : undefined,
    runtimeMin,
    runtimeMax,
    watchlistOnly: params.watchlist === "only" || undefined,
    watchlistExclude: params.watchlist === "exclude" || undefined,
    watchedOnly: params.watched === "only" || undefined,
    hideWatched: params.watched === "hide" || undefined,
    selectedStatuses,
    onlyYou: (params.mine && !params.friends.length) || undefined,
    friendIds: params.friends.length ? params.friends : undefined,
    selectedListIds: params.lists.length ? params.lists : undefined,
    excludeListIds: params.excludeLists.length
      ? params.excludeLists
      : undefined,
    selectedLanguages: params.languages.length ? params.languages : undefined,
  }
}

/**
 * The films feed takes the same dimensions minus the ones that only mean
 * something for a single screening, so it is the showtimes filters with those
 * dropped rather than a second mapping that can drift out of step.
 */
export const feedParamsToMovieFilters = (params: FeedParams) => {
  const { allCinemas: _allCinemas, ...movieFilters } =
    feedParamsToApiFilters(params)
  return movieFilters
}
