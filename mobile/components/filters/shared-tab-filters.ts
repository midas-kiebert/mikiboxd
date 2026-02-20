import type { FilterPresetScope, GoingStatus } from "shared";

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
  { id: "watchlist-only", label: "Watchlist Only" },
  { id: "cinemas", label: "Cinemas" },
  { id: "days", label: "Days" },
  { id: "times", label: "Times" },
  { id: "presets", label: "Presets" },
] as const;

type ThemeColors = typeof import("@/constants/theme").Colors.light;

type BuildPillFiltersInput = {
  colors: ThemeColors;
  selectedShowtimeFilter: SharedTabShowtimeFilter;
  selectedDaysCount: number;
  selectedTimeRangesCount: number;
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

export const buildSharedTabPillFilters = ({
  colors,
  selectedShowtimeFilter,
  selectedDaysCount,
  selectedTimeRangesCount,
}: BuildPillFiltersInput) =>
  SHARED_TAB_FILTERS.map((filter) => {
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
    if (filter.id === "days" && selectedDaysCount > 0) {
      return { ...filter, label: `Days (${selectedDaysCount})` };
    }
    if (filter.id === "times" && selectedTimeRangesCount > 0) {
      return { ...filter, label: `Times (${selectedTimeRangesCount})` };
    }
    return filter;
  });

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
