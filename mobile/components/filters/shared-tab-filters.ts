import type { CinemaPresetPublic, FilterPresetScope, GoingStatus } from "shared";

import { formatDayPillLabel } from "@/components/filters/day-filter-utils";
import { formatTimePillLabel } from "@/components/filters/time-range-utils";

export type SharedTabFilterId =
  | "showtime-filter"
  | "watchlist-only"
  | "cinemas"
  | "days"
  | "times"
  | "presets";

export type SharedTabShowtimeFilter = "all" | "interested" | "going";

export const SHARED_TAB_FILTER_PRESET_SCOPE: FilterPresetScope = "SHOWTIMES";

const SHARED_TAB_FILTERS: ReadonlyArray<{ id: SharedTabFilterId; label: string }> = [
  { id: "showtime-filter", label: "Any Status" },
  { id: "watchlist-only", label: "All Movies" },
  { id: "cinemas", label: "Cinemas" },
  { id: "days", label: "Any Day" },
  { id: "times", label: "any time" },
  { id: "presets", label: "Presets" },
] as const;

type ThemeColors = typeof import("@/constants/theme").Colors.light;
type CinemaPresetSummary = Pick<CinemaPresetPublic, "name" | "cinema_ids">;
const EMPTY_CINEMA_IDS: readonly number[] = [];

type BuildPillFiltersInput = {
  colors: ThemeColors;
  selectedShowtimeFilter: SharedTabShowtimeFilter;
  watchlistOnly: boolean;
  selectedDays: readonly string[];
  selectedTimeRanges: readonly string[];
  sessionCinemaIds?: readonly number[] | null;
  preferredCinemaIds?: readonly number[] | null;
  cinemaPresets?: readonly CinemaPresetSummary[];
};

type BuildActiveFiltersInput = {
  selectedShowtimeFilter: SharedTabShowtimeFilter;
  watchlistOnly: boolean;
  selectedDaysCount: number;
  selectedTimeRangesCount: number;
  isCinemaFilterActive: boolean;
};

export const toSharedTabShowtimeFilter = (
  value: SharedTabShowtimeFilter | null | undefined
): SharedTabShowtimeFilter => {
  if (value === "all" || value === "interested" || value === "going") return value;
  return "all";
};

export const cycleSharedTabShowtimeFilter = (
  current: SharedTabShowtimeFilter
): SharedTabShowtimeFilter => {
  if (current === "all") return "interested";
  if (current === "interested") return "going";
  return "all";
};

export const getSelectedStatusesFromShowtimeFilter = (
  selectedShowtimeFilter: SharedTabShowtimeFilter
): GoingStatus[] | undefined => {
  if (selectedShowtimeFilter === "all") return undefined;
  if (selectedShowtimeFilter === "going") return ["GOING"];
  return ["GOING", "INTERESTED"];
};

const sortCinemaIds = (cinemaIds: Iterable<number>) =>
  Array.from(new Set(cinemaIds)).sort((a, b) => a - b);

const serializeCinemaIds = (cinemaIds: Iterable<number>) => JSON.stringify(sortCinemaIds(cinemaIds));

export const buildSharedTabPillFilters = ({
  colors,
  selectedShowtimeFilter,
  watchlistOnly,
  selectedDays,
  selectedTimeRanges,
  sessionCinemaIds,
  preferredCinemaIds,
  cinemaPresets,
}: BuildPillFiltersInput) => {
  const selectedCinemaIds = sessionCinemaIds ?? preferredCinemaIds ?? EMPTY_CINEMA_IDS;
  const selectedCinemaCount = sortCinemaIds(selectedCinemaIds).length;
  const selectedCinemaSignature = serializeCinemaIds(selectedCinemaIds);
  const matchingCinemaPreset = cinemaPresets?.find(
    (preset) => serializeCinemaIds(preset.cinema_ids) === selectedCinemaSignature
  );
  const cinemasLabel = matchingCinemaPreset?.name?.trim() || `Cinemas (${selectedCinemaCount})`;

  return SHARED_TAB_FILTERS.map((filter) => {
    if (filter.id === "showtime-filter") {
      const label =
        selectedShowtimeFilter === "all"
          ? "Any Status"
          : selectedShowtimeFilter === "going"
            ? "Going"
            : "Interested";
      return {
        ...filter,
        label,
        activeBackgroundColor:
          selectedShowtimeFilter === "going"
            ? colors.green.primary
            : selectedShowtimeFilter === "interested"
              ? colors.orange.primary
              : undefined,
        activeTextColor:
          selectedShowtimeFilter === "going"
            ? colors.green.secondary
            : selectedShowtimeFilter === "interested"
              ? colors.orange.secondary
              : undefined,
        activeBorderColor:
          selectedShowtimeFilter === "going"
            ? colors.green.secondary
            : selectedShowtimeFilter === "interested"
              ? colors.orange.secondary
              : undefined,
      };
    }
    if (filter.id === "watchlist-only") {
      return { ...filter, label: watchlistOnly ? "Watchlist Only" : "All Movies" };
    }
    if (filter.id === "cinemas") {
      return { ...filter, label: cinemasLabel };
    }
    if (filter.id === "days") {
      return { ...filter, label: formatDayPillLabel(selectedDays) };
    }
    if (filter.id === "times") {
      return { ...filter, label: formatTimePillLabel(selectedTimeRanges) };
    }
    return filter;
  });
};

export const buildSharedTabActiveFilterIds = ({
  selectedShowtimeFilter,
  watchlistOnly,
  selectedDaysCount,
  selectedTimeRangesCount,
  isCinemaFilterActive,
}: BuildActiveFiltersInput): SharedTabFilterId[] => {
  const active: SharedTabFilterId[] = [];
  if (selectedShowtimeFilter !== "all") {
    active.push("showtime-filter");
  }
  if (selectedDaysCount > 0) {
    active.push("days");
  }
  if (selectedTimeRangesCount > 0) {
    active.push("times");
  }
  if (isCinemaFilterActive) {
    active.push("cinemas");
  }
  if (watchlistOnly) {
    active.push("watchlist-only");
  }
  return active;
};
