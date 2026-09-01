/**
 * Shared logic for "saved presets" — the unified, partial filter presets that
 * can also pin a cinema selection.
 *
 * A saved preset stores only the dimensions the user chose to include
 * (`untouchedFields` is the opt-out list); applying one sets just the
 * controlled dimensions and leaves everything else unchanged.
 */
import {
  MeService,
  type CinemaScope,
  type Language,
  type SavedPresetCreate,
  type SavedPresetFilters,
  type SavedPresetPublic,
} from "shared";
import { storage } from "shared/storage";

import {
  normalizeFiltersForSave,
  serializeFilters,
  type PageFilterPresetState,
} from "@/components/filters/filter-preset-utils";
import {
  toSharedTabShowtimeFilter,
  type SharedTabShowtimeFilter,
} from "@/components/filters/shared-tab-filters";
import { formatCinemaScopeLabel } from "@/components/filters/cinema-grouping";
import { formatDayPillLabel } from "@/components/filters/day-filter-utils";
import { formatTimePillLabel } from "@/components/filters/time-range-utils";
import { formatRuntimePillLabel } from "@/components/filters/runtime-range-utils";

/** A per-list dimension token, e.g. `list:<uuid>`. */
export type PresetListDimension = `list:${string}`;

export type PresetDimension =
  | "selected_showtime_filter"
  | "watchlist_only"
  | "hide_watched"
  | "days"
  | "time_ranges"
  | "runtime_ranges"
  | "group_by_movie"
  | "selected_languages"
  | "cinemas"
  | PresetListDimension;

const LIST_DIMENSION_PREFIX = "list:";

export const listDimension = (id: string): PresetListDimension =>
  `${LIST_DIMENSION_PREFIX}${id}`;

export const isListDimension = (value: string): value is PresetListDimension =>
  value.startsWith(LIST_DIMENSION_PREFIX);

export const listIdFromDimension = (value: PresetListDimension): string =>
  value.slice(LIST_DIMENSION_PREFIX.length);

/**
 * The non-list, non-cinema dimensions a preset can opt out of controlling. A
 * preset controls (clears + sets) every one of these unless it appears in the
 * preset's `untouchedFields`.
 */
export const CONTROLLABLE_FILTER_DIMENSIONS: PresetDimension[] = [
  "selected_showtime_filter",
  "watchlist_only",
  "hide_watched",
  "days",
  "time_ranges",
  "runtime_ranges",
  "group_by_movie",
  "selected_languages",
];

/** Tokens valid inside `untouchedFields`: filter dimensions + per-list tokens. */
const isUntouchedToken = (value: string): value is PresetDimension =>
  (CONTROLLABLE_FILTER_DIMENSIONS as string[]).includes(value) ||
  isListDimension(value);

/** Unified in-app shape for a saved preset. */
export type DisplayPreset = {
  id: string;
  name: string;
  isFavorite: boolean;
  /** Dimensions the preset leaves as-is on apply; everything else is controlled. */
  untouchedFields: PresetDimension[];
  filters: SavedPresetFilters;
  /** Resolved against the current cinema list by the backend. */
  cinemaIds: number[] | null;
  /**
   * The rule the ids were resolved from — "every cinema", "every cinema in
   * these cities", or a plain list. Only for describing the preset; applying
   * one still goes through `cinemaIds`, which the backend has already
   * expanded. `null` on presets saved before rules existed.
   */
  cinemaScope: CinemaScope | null;
};

const savedToDisplay = (preset: SavedPresetPublic): DisplayPreset => ({
  id: preset.id,
  name: preset.name,
  isFavorite: preset.is_favorite,
  untouchedFields: preset.untouched_fields.filter(isUntouchedToken),
  filters: preset.filters,
  cinemaIds: preset.cinema_ids ?? null,
  cinemaScope: preset.cinema_scope ?? null,
});

export const displayPresetsQueryKey = ["display-presets"] as const;

/** Fetch the user's saved presets. */
export const fetchDisplayPresets = async (): Promise<DisplayPreset[]> => {
  const saved = await MeService.getSavedPresets();
  return saved.map(savedToDisplay);
};

export type PresetApplySetters = {
  hasLetterboxdUsername: boolean;
  setSelectedShowtimeFilter: (value: SharedTabShowtimeFilter) => void;
  setWatchlistOnly: (value: boolean) => void;
  setWatchlistExclude: (value: boolean) => void;
  setHideWatched: (value: boolean) => void;
  setWatchedOnly: (value: boolean) => void;
  setSelectedDays: (value: string[]) => void;
  setSelectedTimeRanges: (value: string[]) => void;
  setSelectedRuntimeRanges: (value: string[]) => void;
  setGroupByMovie: (value: boolean) => void;
  setSelectedLanguages: (value: Language[]) => void;
  setSessionCinemaIds: (value: number[]) => void;
  // Current list selections, needed to preserve lists the preset leaves as-is.
  selectedListIds: readonly string[];
  excludeListIds: readonly string[];
  setSelectedListIds: (value: string[]) => void;
  setExcludeListIds: (value: string[]) => void;
};

const dedupe = (values: Iterable<string>): string[] => Array.from(new Set(values));

/**
 * Apply a preset: control (clear + set) every dimension except the ones the
 * preset leaves as-is (`untouchedFields`). Cinemas are opt-in — only touched
 * when the preset carries a selection.
 */
export const applyDisplayPreset = (
  preset: DisplayPreset,
  setters: PresetApplySetters
): void => {
  const untouched = new Set(preset.untouchedFields);
  const controls = (dimension: PresetDimension) => !untouched.has(dimension);
  const { filters } = preset;
  const { hasLetterboxdUsername } = setters;

  if (controls("selected_showtime_filter")) {
    setters.setSelectedShowtimeFilter(
      toSharedTabShowtimeFilter(filters.selected_showtime_filter)
    );
  }
  if (controls("watchlist_only")) {
    setters.setWatchlistOnly(
      setters.hasLetterboxdUsername && Boolean(filters.watchlist_only)
    );
    setters.setWatchlistExclude(
      setters.hasLetterboxdUsername && Boolean(filters.watchlist_exclude)
    );
  }
  if (controls("hide_watched")) {
    setters.setHideWatched(
      setters.hasLetterboxdUsername && Boolean(filters.hide_watched)
    );
    setters.setWatchedOnly(
      setters.hasLetterboxdUsername && Boolean(filters.watched_only)
    );
  }
  if (controls("days")) {
    setters.setSelectedDays(filters.days ?? []);
  }
  if (controls("time_ranges")) {
    setters.setSelectedTimeRanges(filters.time_ranges ?? []);
  }
  if (controls("runtime_ranges")) {
    setters.setSelectedRuntimeRanges(filters.runtime_ranges ?? []);
  }
  if (controls("group_by_movie")) {
    setters.setGroupByMovie(Boolean(filters.group_by_movie));
  }
  if (controls("selected_languages")) {
    setters.setSelectedLanguages(filters.selected_languages ?? []);
  }
  // Cinemas: opt-in. Only ever applied when the preset carries a selection.
  if (preset.cinemaIds) {
    setters.setSessionCinemaIds(preset.cinemaIds);
  }

  // Lists: keep current ids the preset leaves as-is, then apply the stored ids
  // for every controlled list. Lists with no stored entry (incl. lists added
  // after the preset was saved) end up off.
  if (hasLetterboxdUsername) {
    const keepListId = (id: string) => untouched.has(listDimension(id));
    const applyStored = (ids: readonly string[]) =>
      ids.filter((id) => controls(listDimension(id)));
    setters.setSelectedListIds(
      dedupe([
        ...setters.selectedListIds.filter(keepListId),
        ...applyStored(filters.selected_list_ids ?? []),
      ])
    );
    setters.setExcludeListIds(
      dedupe([
        ...setters.excludeListIds.filter(keepListId),
        ...applyStored(filters.exclude_list_ids ?? []),
      ])
    );
  }
};

/** Everything needed to say what an apply would leave behind. */
export type PresetApplyContext = {
  currentFilters: PageFilterPresetState;
  /** The cinemas the feed is on, resolved the way the pill resolves them. */
  currentCinemaIds: readonly number[];
  hasLetterboxdUsername: boolean;
};

/**
 * What the filters would be after applying `preset` — the same branching as
 * `applyDisplayPreset`, returning the result instead of writing it.
 *
 * Kept immediately below the apply on purpose: the two must agree, and the
 * only way to see that they do is to read them together.
 */
const resultOfApplying = (
  preset: DisplayPreset,
  context: PresetApplyContext
): PageFilterPresetState => {
  const untouched = new Set(preset.untouchedFields);
  const controls = (dimension: PresetDimension) => !untouched.has(dimension);
  const { filters } = preset;
  const { currentFilters: current, hasLetterboxdUsername } = context;
  const next: PageFilterPresetState = { ...current };

  if (controls("selected_showtime_filter")) {
    next.selected_showtime_filter = toSharedTabShowtimeFilter(
      filters.selected_showtime_filter
    );
  }
  if (controls("watchlist_only")) {
    next.watchlist_only = hasLetterboxdUsername && Boolean(filters.watchlist_only);
    next.watchlist_exclude = hasLetterboxdUsername && Boolean(filters.watchlist_exclude);
  }
  if (controls("hide_watched")) {
    next.hide_watched = hasLetterboxdUsername && Boolean(filters.hide_watched);
    next.watched_only = hasLetterboxdUsername && Boolean(filters.watched_only);
  }
  if (controls("days")) next.days = filters.days ?? [];
  if (controls("time_ranges")) next.time_ranges = filters.time_ranges ?? [];
  if (controls("runtime_ranges")) next.runtime_ranges = filters.runtime_ranges ?? [];
  if (controls("group_by_movie")) next.group_by_movie = Boolean(filters.group_by_movie);
  if (controls("selected_languages")) {
    next.selected_languages = filters.selected_languages ?? [];
  }

  if (hasLetterboxdUsername) {
    const keepListId = (id: string) => untouched.has(listDimension(id));
    const applyStored = (ids: readonly string[]) =>
      ids.filter((id) => controls(listDimension(id)));
    next.selected_list_ids = dedupe([
      ...(current.selected_list_ids ?? []).filter(keepListId),
      ...applyStored(filters.selected_list_ids ?? []),
    ]);
    next.exclude_list_ids = dedupe([
      ...(current.exclude_list_ids ?? []).filter(keepListId),
      ...applyStored(filters.exclude_list_ids ?? []),
    ]);
  }

  return next;
};

const sortedIds = (ids: readonly number[]): string =>
  Array.from(new Set(ids))
    .sort((left, right) => left - right)
    .join(",");

/**
 * Whether applying this preset would move the cinema selection.
 *
 * Its own predicate because the cinema pill is the one dimension with no chip:
 * the filter row can watch every other change land as a chip arriving or
 * leaving, but a preset that writes the cinemas it is already on looks from
 * there exactly like one that skipped them — and the row has to tell those
 * apart, because only one of them has anything to animate.
 */
export const presetChangesCinemas = (
  preset: DisplayPreset,
  context: PresetApplyContext
): boolean =>
  preset.cinemaIds != null &&
  sortedIds(preset.cinemaIds) !== sortedIds(context.currentCinemaIds);

/**
 * Whether applying this preset would leave everything exactly as it is.
 *
 * Compared through `serializeFilters` rather than field by field, so that a
 * different order of the same days — or any other difference the filters
 * themselves treat as none — counts as no change here too.
 */
export const presetChangesNothing = (
  preset: DisplayPreset,
  context: PresetApplyContext
): boolean => {
  if (presetChangesCinemas(preset, context)) {
    return false;
  }
  return (
    serializeFilters(resultOfApplying(preset, context)) ===
    serializeFilters(context.currentFilters)
  );
};

/**
 * The dimensions an apply of this preset writes to — whether or not the value
 * it writes differs from what is already there.
 *
 * A partial preset is only legible if the row can tell "this preset does not
 * carry days" from "this preset carries the days you already had". The first
 * has to leave the day chip alone; the second has to show the chip being set,
 * or the preset looks like it half-worked. Only the apply knows the
 * difference, so it says so (see `preset-apply-signal`).
 *
 * List dimensions are reported for the ids the preset actually stores. A list
 * it merely switches off says so by the chip going, which needs no help.
 */
export const controlledPresetDimensions = (preset: DisplayPreset): PresetDimension[] => {
  const untouched = new Set(preset.untouchedFields);
  const controlled: PresetDimension[] = CONTROLLABLE_FILTER_DIMENSIONS.filter(
    (dimension) => !untouched.has(dimension)
  );

  const storedListIds = dedupe([
    ...(preset.filters.selected_list_ids ?? []),
    ...(preset.filters.exclude_list_ids ?? []),
  ]);
  for (const id of storedListIds) {
    const dimension = listDimension(id);
    if (!untouched.has(dimension)) controlled.push(dimension);
  }

  if (preset.cinemaIds) controlled.push("cinemas");
  return controlled;
};

export const deleteDisplayPreset = (preset: DisplayPreset): Promise<unknown> =>
  MeService.deleteSavedPreset({ presetId: preset.id });

/** Stable identity for ordering/keying. */
export const presetKey = (preset: Pick<DisplayPreset, "id">) => preset.id;

/**
 * Set or clear the favorite preset. Marking a preset favorite is what makes
 * it apply on startup (see useSharedTabFilters).
 */
export const setDisplayPresetFavorite = async (
  preset: DisplayPreset,
  makeFavorite: boolean
): Promise<void> => {
  if (!makeFavorite) {
    await MeService.clearFavoriteSavedPreset();
    return;
  }
  await MeService.setFavoriteSavedPreset({ presetId: preset.id });
};

// ─── Manual ordering (persisted locally, shared by chips + manage modal) ──────

const ORDER_STORAGE_KEY = "display_preset_order_v1";

export const displayPresetOrderQueryKey = ["display-preset-order"] as const;

export const loadDisplayPresetOrder = async (): Promise<string[]> => {
  try {
    const raw = await storage.getItem(ORDER_STORAGE_KEY);
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

export const saveDisplayPresetOrder = async (keys: readonly string[]): Promise<void> => {
  await storage.setItem(ORDER_STORAGE_KEY, JSON.stringify(Array.from(new Set(keys))));
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
  isFavorite: boolean;
  /** Dimensions the user opted to leave as-is (must exclude `cinemas`). */
  untouchedFields: PresetDimension[];
  includeCinemas: boolean;
  currentFilters: PageFilterPresetState;
  cinemaIds: number[];
  /**
   * The cinema preset the current selection exactly matches, if any. When
   * set, the saved preset follows that cinema preset live (edits to it, or
   * its deletion, are picked up automatically — see the backend's
   * `SavedPreset.cinema_preset_id`) instead of freezing `cinemaIds`.
   */
  matchedCinemaPresetId?: string | null;
}): SavedPresetCreate => ({
  name: args.name,
  untouched_fields: args.untouchedFields,
  filters: normalizeFiltersForSave(args.currentFilters),
  cinema_ids:
    args.includeCinemas && !args.matchedCinemaPresetId ? args.cinemaIds : null,
  cinema_preset_id: args.includeCinemas ? args.matchedCinemaPresetId ?? null : null,
  is_favorite: args.isFavorite,
});

/** One row in the "save preset" prompt: a dimension the user can include. */
export type DimensionSummary = {
  dimension: PresetDimension;
  title: string;
  valueLabel: string;
  active: boolean;
};

/** A list shown as its own selector row in the save prompt. */
export type PresetListSummary = { id: string; title: string };

const getStatusLabel = (value: SharedTabShowtimeFilter): string => {
  if (value === "going") return "Going";
  if (value === "interested") return "Interested";
  return "Any status";
};

const getMovieSetLabel = (include: boolean, exclude: boolean): string =>
  include ? "Show" : exclude ? "Hide" : "Off";

const LANGUAGE_LABELS: Record<Language, string> = { nl: "Dutch", en: "English" };

const formatLanguagesLabel = (languages: readonly Language[]): string =>
  languages.length > 0
    ? languages.map((language) => LANGUAGE_LABELS[language]).join(", ")
    : "Any language";

/**
 * Describe the user's current selections for the save prompt — one row per
 * available dimension, flagged `active` when it is set to something other than
 * its default. Each row is a checkbox: checked means the preset controls that
 * dimension; unchecked leaves it as-is on apply.
 */
export const summarizeCurrentSelections = (args: {
  currentFilters: PageFilterPresetState;
  cinemaLabel: string;
  cinemaActive: boolean;
  canUseWatchlistFilter: boolean;
  showRuntime: boolean;
  showGroupBy: boolean;
  lists: readonly PresetListSummary[];
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
    const watchlistInclude = Boolean(currentFilters.watchlist_only);
    const watchlistExclude = Boolean(currentFilters.watchlist_exclude);
    rows.push({
      dimension: "watchlist_only",
      title: "Watchlist",
      valueLabel: getMovieSetLabel(watchlistInclude, watchlistExclude),
      active: watchlistInclude || watchlistExclude,
    });

    const watchedInclude = Boolean(currentFilters.watched_only);
    const watchedExclude = Boolean(currentFilters.hide_watched);
    rows.push({
      dimension: "hide_watched",
      title: "Watched",
      valueLabel: getMovieSetLabel(watchedInclude, watchedExclude),
      active: watchedInclude || watchedExclude,
    });

    const selectedLists = new Set(currentFilters.selected_list_ids ?? []);
    const excludeLists = new Set(currentFilters.exclude_list_ids ?? []);
    for (const list of args.lists) {
      const include = selectedLists.has(list.id);
      const exclude = excludeLists.has(list.id);
      rows.push({
        dimension: listDimension(list.id),
        title: list.title,
        valueLabel: getMovieSetLabel(include, exclude),
        active: include || exclude,
      });
    }
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
      title: "Movie Length",
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

  const selectedLanguages = currentFilters.selected_languages ?? [];
  rows.push({
    dimension: "selected_languages",
    title: "Language",
    valueLabel: formatLanguagesLabel(selectedLanguages),
    active: selectedLanguages.length > 0,
  });

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
 * "Interested · Today · Evening · < 90 min · All Amsterdam cinemas"
 * Used in the manage-presets list and any other places that need a one-liner.
 */
export const describeDisplayPreset = (
  preset: DisplayPreset,
  cityNamesById: ReadonlyMap<number, string>
): string => {
  const untouched = new Set(preset.untouchedFields);
  const controls = (dimension: PresetDimension) => !untouched.has(dimension);
  const f = preset.filters;
  const parts: string[] = [];

  if (controls("selected_showtime_filter")) {
    const status = toSharedTabShowtimeFilter(f.selected_showtime_filter);
    if (status === "going") parts.push("Going");
    else if (status === "interested") parts.push("Interested");
  }
  if (controls("watchlist_only")) {
    if (f.watchlist_only) parts.push("Watchlist");
    else if (f.watchlist_exclude) parts.push("Hide watchlist");
  }
  if (controls("hide_watched")) {
    if (f.watched_only) parts.push("Watched");
    else if (f.hide_watched) parts.push("Hide watched");
  }
  const listCount =
    (f.selected_list_ids ?? []).filter((id) => controls(listDimension(id))).length +
    (f.exclude_list_ids ?? []).filter((id) => controls(listDimension(id))).length;
  if (listCount > 0) {
    parts.push(`${listCount} list${listCount === 1 ? "" : "s"}`);
  }
  if (controls("days") && (f.days?.length ?? 0) > 0) {
    parts.push(formatDayPillLabel(f.days ?? []));
  }
  if (controls("time_ranges") && (f.time_ranges?.length ?? 0) > 0) {
    parts.push(formatTimePillLabel(f.time_ranges ?? []));
  }
  if (controls("runtime_ranges") && (f.runtime_ranges?.length ?? 0) > 0) {
    parts.push(formatRuntimePillLabel(f.runtime_ranges ?? []));
  }
  if (controls("group_by_movie") && f.group_by_movie) {
    parts.push("Group by movies");
  }
  if (controls("selected_languages") && (f.selected_languages?.length ?? 0) > 0) {
    parts.push(formatLanguagesLabel(f.selected_languages ?? []));
  }
  if (preset.cinemaIds != null) {
    parts.push(
      formatCinemaScopeLabel(preset.cinemaScope, preset.cinemaIds, cityNamesById)
    );
  }

  return parts.length > 0 ? parts.join(" · ") : "No restrictions";
};
