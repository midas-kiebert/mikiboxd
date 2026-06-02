/**
 * Shared utilities for filter preset matching and serialization.
 * Extracted from FilterPresetsModal so FiltersModal and FiltersRow can reuse them.
 */
import type { FilterPresetFilters } from "shared";
import { canonicalizeDaySelections } from "@/components/filters/day-filter-utils";
import { normalizeSingleRuntimeRangeSelection } from "@/components/filters/runtime-range-utils";
import type { PageFilterPresetState } from "@/components/filters/FilterPresetsModal";

const getSortedUniqueStrings = (values?: string[] | null): string[] | null => {
  if (!values || values.length === 0) return null;
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
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
  days: canonicalizeDaySelections(filters.days),
  time_ranges: getSortedUniqueStrings(filters.time_ranges),
  runtime_ranges: getSortedUniqueStrings(
    normalizeSingleRuntimeRangeSelection(filters.runtime_ranges ?? [])
  ),
});

export const serializeFilters = (filters: PageFilterPresetState): string =>
  JSON.stringify(normalizeFilters(filters));

export const normalizeFiltersForSave = (filters: PageFilterPresetState): FilterPresetFilters => {
  const normalized = normalizeFilters(filters);
  return {
    selected_showtime_filter: normalized.selected_showtime_filter ?? null,
    showtime_audience:
      normalized.showtime_audience === "only-you" ? "only-you" : "including-friends",
    watchlist_only: Boolean(normalized.watchlist_only),
    days: normalized.days ?? null,
    time_ranges: normalized.time_ranges ?? null,
    runtime_ranges: normalized.runtime_ranges ?? null,
  };
};
