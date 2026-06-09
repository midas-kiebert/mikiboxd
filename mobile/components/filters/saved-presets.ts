/**
 * Shared logic for "saved presets" — the unified, partial filter presets that
 * can also pin a cinema selection.
 *
 * A saved preset stores only the dimensions the user chose to include
 * (`includedFields`); applying one sets just those and leaves every other
 * active filter unchanged. Legacy filter presets (full-replacement, no cinema)
 * are surfaced alongside the new ones so existing presets keep working — they
 * are treated as "all filter fields included, no cinema".
 */
import {
  MeService,
  type FilterPresetFilters,
  type FilterPresetPublic,
  type FilterPresetScope,
  type SavedPresetCreate,
  type SavedPresetPublic,
} from "shared";
import { storage } from "shared/storage";

import { normalizeFiltersForSave } from "@/components/filters/filter-preset-utils";
import { type PageFilterPresetState } from "@/components/filters/FilterPresetsModal";
import {
  toSharedTabShowtimeFilter,
  type SharedTabShowtimeFilter,
} from "@/components/filters/shared-tab-filters";
import { formatDayPillLabel } from "@/components/filters/day-filter-utils";
import { formatTimePillLabel } from "@/components/filters/time-range-utils";
import { formatRuntimePillLabel } from "@/components/filters/runtime-range-utils";

export type PresetDimension =
  | "selected_showtime_filter"
  | "watchlist_only"
  | "days"
  | "time_ranges"
  | "runtime_ranges"
  | "group_by_movie"
  | "cinemas";

/** Filter dimensions a legacy preset implicitly carries (everything but cinemas). */
export const FILTER_DIMENSIONS: PresetDimension[] = [
  "selected_showtime_filter",
  "watchlist_only",
  "days",
  "time_ranges",
  "runtime_ranges",
  "group_by_movie",
];

const ALL_DIMENSIONS: PresetDimension[] = [...FILTER_DIMENSIONS, "cinemas"];

const isPresetDimension = (value: string): value is PresetDimension =>
  (ALL_DIMENSIONS as string[]).includes(value);

/** Unified in-app shape for a preset, whichever backend it came from. */
export type DisplayPreset = {
  source: "legacy" | "saved";
  id: string;
  name: string;
  isFavorite: boolean;
  includedFields: PresetDimension[];
  filters: FilterPresetFilters;
  cinemaIds: number[] | null;
};

const legacyToDisplay = (preset: FilterPresetPublic): DisplayPreset => ({
  source: "legacy",
  id: preset.id,
  name: preset.name,
  isFavorite: preset.is_favorite,
  includedFields: [...FILTER_DIMENSIONS],
  filters: preset.filters,
  cinemaIds: null,
});

const savedToDisplay = (preset: SavedPresetPublic): DisplayPreset => ({
  source: "saved",
  id: preset.id,
  name: preset.name,
  isFavorite: preset.is_favorite,
  includedFields: preset.included_fields.filter(isPresetDimension),
  filters: preset.filters,
  cinemaIds: preset.cinema_ids ?? null,
});

export const displayPresetsQueryKey = (scope: FilterPresetScope) =>
  ["display-presets", scope] as const;

/**
 * Fetch the user's new saved presets and legacy filter presets for a scope and
 * merge them into a single list (saved first, then legacy). The synthetic
 * "Default" legacy preset (which represents "no filters") is dropped.
 */
export const fetchDisplayPresets = async (
  scope: FilterPresetScope
): Promise<DisplayPreset[]> => {
  const [saved, legacy] = await Promise.all([
    MeService.getSavedPresets({ scope }).catch(() => [] as SavedPresetPublic[]),
    MeService.getFilterPresets({ scope }).catch(() => [] as FilterPresetPublic[]),
  ]);
  const savedDisplays = saved.map(savedToDisplay);
  const legacyDisplays = legacy
    .filter((preset) => !preset.is_default)
    .map(legacyToDisplay);
  return [...savedDisplays, ...legacyDisplays];
};

export type PresetApplySetters = {
  hasLetterboxdUsername: boolean;
  setSelectedShowtimeFilter: (value: SharedTabShowtimeFilter) => void;
  setWatchlistOnly: (value: boolean) => void;
  setSelectedDays: (value: string[]) => void;
  setSelectedTimeRanges: (value: string[]) => void;
  setSelectedRuntimeRanges: (value: string[]) => void;
  setGroupByMovie: (value: boolean) => void;
  setSessionCinemaIds: (value: number[]) => void;
};

/**
 * Apply a preset additively: set only the dimensions it includes, leaving every
 * other active filter untouched.
 */
export const applyDisplayPreset = (
  preset: DisplayPreset,
  setters: PresetApplySetters
): void => {
  const included = new Set(preset.includedFields);
  if (included.has("selected_showtime_filter")) {
    setters.setSelectedShowtimeFilter(
      toSharedTabShowtimeFilter(preset.filters.selected_showtime_filter)
    );
  }
  if (included.has("watchlist_only")) {
    setters.setWatchlistOnly(
      setters.hasLetterboxdUsername && Boolean(preset.filters.watchlist_only)
    );
  }
  if (included.has("days")) {
    setters.setSelectedDays(preset.filters.days ?? []);
  }
  if (included.has("time_ranges")) {
    setters.setSelectedTimeRanges(preset.filters.time_ranges ?? []);
  }
  if (included.has("runtime_ranges")) {
    setters.setSelectedRuntimeRanges(preset.filters.runtime_ranges ?? []);
  }
  if (included.has("group_by_movie")) {
    setters.setGroupByMovie(Boolean(preset.filters.group_by_movie));
  }
  if (included.has("cinemas") && preset.cinemaIds) {
    setters.setSessionCinemaIds(preset.cinemaIds);
  }
};

export const deleteDisplayPreset = (preset: DisplayPreset): Promise<unknown> =>
  preset.source === "saved"
    ? MeService.deleteSavedPreset({ presetId: preset.id })
    : MeService.deleteFilterPreset({ presetId: preset.id });

/** Stable identity across both backends (ids are per-table). */
export const presetKey = (preset: Pick<DisplayPreset, "source" | "id">) =>
  `${preset.source}:${preset.id}`;

/**
 * Set or clear the single favorite preset for a scope. Favorite is unique
 * across both backends (the legacy and the new one), so the favorite in the
 * other system is cleared. Marking a preset favorite is what makes it apply on
 * startup (see useSharedTabFilters).
 */
export const setDisplayPresetFavorite = async (
  preset: DisplayPreset,
  scope: FilterPresetScope,
  makeFavorite: boolean
): Promise<void> => {
  if (!makeFavorite) {
    await Promise.all([
      MeService.clearFavoriteSavedPreset({ scope }),
      MeService.clearFavoriteFilterPreset({ scope }),
    ]);
    return;
  }
  if (preset.source === "saved") {
    await MeService.setFavoriteSavedPreset({ presetId: preset.id });
    await MeService.clearFavoriteFilterPreset({ scope });
  } else {
    await MeService.setFavoriteFilterPreset({ presetId: preset.id });
    await MeService.clearFavoriteSavedPreset({ scope });
  }
};

// ─── Manual ordering (persisted locally, shared by chips + manage modal) ──────

const ORDER_STORAGE_PREFIX = "display_preset_order_v1";
const orderStorageKey = (scope: FilterPresetScope) =>
  `${ORDER_STORAGE_PREFIX}_${scope.toLowerCase()}`;

export const displayPresetOrderQueryKey = (scope: FilterPresetScope) =>
  ["display-preset-order", scope] as const;

export const loadDisplayPresetOrder = async (
  scope: FilterPresetScope
): Promise<string[]> => {
  try {
    const raw = await storage.getItem(orderStorageKey(scope));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return Array.from(
      new Set(parsed.filter((value): value is string => typeof value === "string"))
    );
  } catch {
    return [];
  }
};

export const saveDisplayPresetOrder = async (
  scope: FilterPresetScope,
  keys: readonly string[]
): Promise<void> => {
  await storage.setItem(orderStorageKey(scope), JSON.stringify(Array.from(new Set(keys))));
};

/** Sort by the persisted manual order; anything unordered keeps its fetch order. */
export const sortDisplayPresetsByOrder = (
  presets: readonly DisplayPreset[],
  orderedKeys: readonly string[]
): DisplayPreset[] => {
  const indexByKey = new Map(orderedKeys.map((key, index) => [key, index]));
  return [...presets].sort((left, right) => {
    const leftIndex = indexByKey.get(presetKey(left));
    const rightIndex = indexByKey.get(presetKey(right));
    if (leftIndex !== undefined || rightIndex !== undefined) {
      if (leftIndex === undefined) return 1;
      if (rightIndex === undefined) return -1;
      if (leftIndex !== rightIndex) return leftIndex - rightIndex;
    }
    return 0;
  });
};

export const buildSavedPresetCreate = (args: {
  name: string;
  scope: FilterPresetScope;
  isFavorite: boolean;
  includedFields: PresetDimension[];
  currentFilters: PageFilterPresetState;
  cinemaIds: number[];
}): SavedPresetCreate => {
  const includeCinemas = args.includedFields.includes("cinemas");
  return {
    name: args.name,
    scope: args.scope,
    included_fields: args.includedFields,
    filters: normalizeFiltersForSave(args.currentFilters),
    cinema_ids: includeCinemas ? args.cinemaIds : null,
    is_favorite: args.isFavorite,
  };
};

/** One row in the "save preset" prompt: a dimension the user can include. */
export type DimensionSummary = {
  dimension: PresetDimension;
  title: string;
  valueLabel: string;
  active: boolean;
};

const getStatusLabel = (value: SharedTabShowtimeFilter): string => {
  if (value === "going") return "Going";
  if (value === "interested") return "Interested";
  return "Any status";
};

/**
 * Describe the user's current selections for the save prompt — one row per
 * available dimension, flagged `active` when it is set to something other than
 * its default. The dialog pre-checks the active rows.
 */
export const summarizeCurrentSelections = (args: {
  currentFilters: PageFilterPresetState;
  cinemaLabel: string;
  cinemaActive: boolean;
  canUseWatchlistFilter: boolean;
  showRuntime: boolean;
  showGroupBy: boolean;
}): DimensionSummary[] => {
  const { currentFilters } = args;
  const status = toSharedTabShowtimeFilter(currentFilters.selected_showtime_filter);
  const days = currentFilters.days ?? [];
  const timeRanges = currentFilters.time_ranges ?? [];
  const runtimeRanges = currentFilters.runtime_ranges ?? [];

  const rows: DimensionSummary[] = [
    {
      dimension: "selected_showtime_filter",
      title: "Status",
      valueLabel: getStatusLabel(status),
      active: status !== "all",
    },
  ];

  if (args.canUseWatchlistFilter) {
    rows.push({
      dimension: "watchlist_only",
      title: "Watchlist",
      valueLabel: currentFilters.watchlist_only ? "Watchlisted only" : "All movies",
      active: Boolean(currentFilters.watchlist_only),
    });
  }

  rows.push({
    dimension: "days",
    title: "Days",
    valueLabel: formatDayPillLabel(days),
    active: days.length > 0,
  });

  rows.push({
    dimension: "time_ranges",
    title: "Time",
    valueLabel: formatTimePillLabel(timeRanges),
    active: timeRanges.length > 0,
  });

  if (args.showRuntime) {
    rows.push({
      dimension: "runtime_ranges",
      title: "Runtime",
      valueLabel: formatRuntimePillLabel(runtimeRanges),
      active: runtimeRanges.length > 0,
    });
  }

  if (args.showGroupBy) {
    const groupByMovie = Boolean(args.currentFilters.group_by_movie);
    rows.push({
      dimension: "group_by_movie",
      title: "Group by",
      valueLabel: groupByMovie ? "Movies" : "Showtimes",
      active: groupByMovie,
    });
  }

  rows.push({
    dimension: "cinemas",
    title: "Cinemas",
    valueLabel: args.cinemaLabel,
    active: args.cinemaActive,
  });

  return rows;
};

/**
 * Build a compact human-readable summary of what a preset will apply, e.g.
 * "Interested · Today · Evening · < 90 min · 3 cinemas"
 * Used in the manage-presets list and any other places that need a one-liner.
 */
export const describeDisplayPreset = (preset: DisplayPreset): string => {
  const included = new Set(preset.includedFields);
  const f = preset.filters;
  const parts: string[] = [];

  if (included.has("selected_showtime_filter")) {
    const status = toSharedTabShowtimeFilter(f.selected_showtime_filter);
    parts.push(status === "going" ? "Going" : status === "interested" ? "Interested" : "Any status");
  }
  if (included.has("watchlist_only")) {
    parts.push(f.watchlist_only ? "Watchlisted" : "All movies");
  }
  if (included.has("days")) {
    parts.push(formatDayPillLabel(f.days ?? []));
  }
  if (included.has("time_ranges")) {
    parts.push(formatTimePillLabel(f.time_ranges ?? []));
  }
  if (included.has("runtime_ranges")) {
    parts.push(formatRuntimePillLabel(f.runtime_ranges ?? []));
  }
  if (included.has("group_by_movie")) {
    parts.push(f.group_by_movie ? "Group by movies" : "Group by showtimes");
  }
  if (included.has("cinemas") && preset.cinemaIds != null) {
    const n = preset.cinemaIds.length;
    parts.push(`${n} cinema${n === 1 ? "" : "s"}`);
  }

  return parts.join(" · ");
};
