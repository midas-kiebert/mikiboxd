/**
 * Shared utilities for filter preset matching and serialization, used by
 * FiltersModal, FiltersRow, and the saved-presets feature.
 */
import type { Language, SavedPresetFilters } from "shared";
import { canonicalizeDaySelections } from "@/components/filters/day-filter-utils";
import { normalizeSingleRuntimeRangeSelection } from "@/components/filters/runtime-range-utils";

export type PageFilterPresetState = {
  selected_showtime_filter?: "all" | "interested" | "going" | null;
  showtime_audience?: "including-friends" | "only-you" | null;
  watchlist_only?: boolean;
  watchlist_exclude?: boolean;
  hide_watched?: boolean;
  watched_only?: boolean;
  selected_list_ids?: string[] | null;
  exclude_list_ids?: string[] | null;
  days?: string[] | null;
  time_ranges?: string[] | null;
  runtime_ranges?: string[] | null;
  group_by_movie?: boolean;
  selected_languages?: Language[] | null;
};

const getSortedUniqueStrings = (values?: string[] | null): string[] | null => {
  if (!values || values.length === 0) return null;
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
};

const getSortedUniqueLanguages = (values?: Language[] | null): Language[] | null => {
  if (!values || values.length === 0) return null;
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b)) as Language[];
};

export const normalizeFilters = (filters: PageFilterPresetState): PageFilterPresetState => ({
  selected_showtime_filter:
    filters.selected_showtime_filter === "all" ||
    filters.selected_showtime_filter === "interested" ||
    filters.selected_showtime_filter === "going"
      ? filters.selected_showtime_filter
      : null,
  showtime_audience:
    filters.showtime_audience === "only-you" || filters.showtime_audience === "including-friends"
      ? filters.showtime_audience
      : "including-friends",
  watchlist_only: Boolean(filters.watchlist_only),
  watchlist_exclude: Boolean(filters.watchlist_exclude),
  hide_watched: Boolean(filters.hide_watched),
  watched_only: Boolean(filters.watched_only),
  selected_list_ids: getSortedUniqueStrings(filters.selected_list_ids),
  exclude_list_ids: getSortedUniqueStrings(filters.exclude_list_ids),
  days: canonicalizeDaySelections(filters.days),
  time_ranges: getSortedUniqueStrings(filters.time_ranges),
  runtime_ranges: getSortedUniqueStrings(
    normalizeSingleRuntimeRangeSelection(filters.runtime_ranges ?? [])
  ),
  group_by_movie: Boolean(filters.group_by_movie),
  selected_languages: getSortedUniqueLanguages(filters.selected_languages),
});

export const serializeFilters = (filters: PageFilterPresetState): string =>
  JSON.stringify(normalizeFilters(filters));

export const normalizeFiltersForSave = (filters: PageFilterPresetState): SavedPresetFilters => {
  const normalized = normalizeFilters(filters);
  return {
    selected_showtime_filter: normalized.selected_showtime_filter ?? null,
    showtime_audience:
      normalized.showtime_audience === "only-you" ? "only-you" : "including-friends",
    watchlist_only: Boolean(normalized.watchlist_only),
    watchlist_exclude: Boolean(normalized.watchlist_exclude),
    hide_watched: Boolean(normalized.hide_watched),
    watched_only: Boolean(normalized.watched_only),
    selected_list_ids: normalized.selected_list_ids ?? null,
    exclude_list_ids: normalized.exclude_list_ids ?? null,
    days: normalized.days ?? null,
    time_ranges: normalized.time_ranges ?? null,
    runtime_ranges: normalized.runtime_ranges ?? null,
    group_by_movie: normalized.group_by_movie ?? null,
    selected_languages: normalized.selected_languages ?? null,
  };
};
