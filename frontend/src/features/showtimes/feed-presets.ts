/**
 * Saved presets, translated to and from the feed's URL state.
 *
 * The preset model is entirely shared with the app — which dimensions a preset
 * controls, which it deliberately leaves alone, how a cinema selection is
 * frozen or followed live. None of that is reimplemented here. The only thing
 * the website needs is an adapter, because the shared code applies a preset
 * through a bag of individual setters (the app holds each dimension in its own
 * piece of state) while the feed holds all of them in one `FeedParams`.
 *
 * So the setters collect into a single patch and the feed navigates once.
 * Calling `setParams` twelve times would put twelve entries in the browser's
 * history and refetch the feed on each one.
 */
import type { Language } from "shared/client"
import {
  type DisplayPreset,
  type PresetApplySetters,
  applyDisplayPreset,
} from "shared/filters/saved-presets"
import type { PageFilterPresetState } from "shared/filters/filter-preset-utils"
import type { SharedTabShowtimeFilter } from "shared/filters/shared-tab-filters"

import type { FeedParams, WatchedMode, WatchlistMode } from "./feed-params"

/**
 * Run a preset against the current params and return everything it changed.
 *
 * Watchlist and watched are one three-way value each on the web where the
 * shared setters treat them as two booleans, so the "only"/"exclude" pair is
 * folded back together after both have had their say — otherwise whichever
 * setter ran last would win and the other half would be silently dropped.
 */
export const presetPatchForFeed = (
  preset: DisplayPreset,
  params: FeedParams,
  hasLetterboxdUsername: boolean,
): Partial<FeedParams> => {
  const patch: Partial<FeedParams> = {}

  let watchlistOnly = params.watchlist === "only"
  let watchlistExclude = params.watchlist === "exclude"
  let watchedOnly = params.watched === "only"
  let hideWatched = params.watched === "hide"

  const setters: PresetApplySetters = {
    hasLetterboxdUsername,
    setSelectedShowtimeFilter: (value: SharedTabShowtimeFilter) => {
      patch.status = value
    },
    setWatchlistOnly: (value) => {
      watchlistOnly = value
    },
    setWatchlistExclude: (value) => {
      watchlistExclude = value
    },
    setHideWatched: (value) => {
      hideWatched = value
    },
    setWatchedOnly: (value) => {
      watchedOnly = value
    },
    setSelectedDays: (value) => {
      patch.days = value
    },
    setSelectedTimeRanges: (value) => {
      patch.times = value
    },
    setSelectedRuntimeRanges: (value) => {
      patch.runtime = value
    },
    setGroupByMovie: (value) => {
      patch.group = value
    },
    setSelectedLanguages: (value: Language[]) => {
      patch.languages = value
    },
    setSessionCinemaIds: (value) => {
      patch.cinemas = value
    },
    selectedListIds: params.lists,
    excludeListIds: params.excludeLists,
    setSelectedListIds: (value) => {
      patch.lists = value
    },
    setExcludeListIds: (value) => {
      patch.excludeLists = value
    },
  }

  applyDisplayPreset(preset, setters)

  // "only" wins over "exclude" if a preset somehow asks for both: it is the
  // narrower answer, and showing too little is easier to notice than too much.
  const watchlist: WatchlistMode = watchlistOnly
    ? "only"
    : watchlistExclude
      ? "exclude"
      : "any"
  const watched: WatchedMode = watchedOnly
    ? "only"
    : hideWatched
      ? "hide"
      : "any"

  if (watchlist !== params.watchlist) patch.watchlist = watchlist
  if (watched !== params.watched) patch.watched = watched

  return patch
}

/** The current feed state in the shape a preset is saved from. */
export const feedParamsToPresetState = (
  params: FeedParams,
): PageFilterPresetState => ({
  selected_showtime_filter: params.status,
  watchlist_only: params.watchlist === "only",
  watchlist_exclude: params.watchlist === "exclude",
  hide_watched: params.watched === "hide",
  watched_only: params.watched === "only",
  selected_list_ids: params.lists.length ? [...params.lists] : null,
  exclude_list_ids: params.excludeLists.length ? [...params.excludeLists] : null,
  days: params.days.length ? [...params.days] : null,
  time_ranges: params.times.length ? [...params.times] : null,
  runtime_ranges: params.runtime.length ? [...params.runtime] : null,
  group_by_movie: params.group,
  selected_languages: params.languages.length ? [...params.languages] : null,
})
