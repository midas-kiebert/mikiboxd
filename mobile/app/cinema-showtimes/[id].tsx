/**
 * Expo Router screen/module for cinema-showtimes / [id]. It controls navigation and screen-level state for this route.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { DateTime } from "luxon";
import { useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useIsFocused } from "@react-navigation/native";
import { useFetchMainPageShowtimes } from "shared/hooks/useFetchMainPageShowtimes";
import { useFetchMyShowtimes } from "shared/hooks/useFetchMyShowtimes";
import { useFetchCinemas } from "shared/hooks/useFetchCinemas";

import ShowtimesScreen from "@/components/showtimes/ShowtimesScreen";
import DayFilterModal from "@/components/filters/DayFilterModal";
import DayQuickPopover from "@/components/filters/DayQuickPopover";
import { type FilterPillLongPressPosition } from "@/components/filters/FilterPills";
import TimeFilterModal from "@/components/filters/TimeFilterModal";
import TimeQuickPopover from "@/components/filters/TimeQuickPopover";
import { resolveDaySelectionsForApi } from "@/components/filters/day-filter-utils";
import {
  buildSharedTabActiveFilterIds,
  buildSharedTabPillFilters,
  cycleSharedTabShowtimeFilter,
  getSelectedStatusesFromShowtimeFilter,
  type SharedTabFilterId,
} from "@/components/filters/shared-tab-filters";
import { resetInfiniteQuery } from "@/utils/reset-infinite-query";
import { useThemeColors } from "@/hooks/use-theme-color";
import { useSharedTabFilters } from "@/hooks/useSharedTabFilters";

const CINEMA_FILTER_IDS: ReadonlyArray<SharedTabFilterId> = [
  "showtime-filter",
  "watchlist-only",
  "days",
  "times",
];
const CINEMA_FILTER_ID_SET = new Set<SharedTabFilterId>(CINEMA_FILTER_IDS);
type CinemaShowtimesFilterId = (typeof CINEMA_FILTER_IDS)[number];
type AudienceFilter = "including-friends" | "only-you";

const EMPTY_DAYS: string[] = [];
const EMPTY_TIME_RANGES: string[] = [];

const getRouteParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export default function CinemaShowtimesScreen() {
  // Read flow: local state and data hooks first, then handlers, then the JSX screen.
  const colors = useThemeColors();
  const { id, name, city } = useLocalSearchParams<{
    id?: string | string[];
    name?: string | string[];
    city?: string | string[];
  }>();
  const routeCinemaId = useMemo(() => Number(getRouteParam(id)), [id]);
  const cinemaId = Number.isFinite(routeCinemaId) && routeCinemaId > 0 ? routeCinemaId : -1;
  const routeCinemaName = useMemo(() => getRouteParam(name)?.trim() ?? "", [name]);
  const routeCityName = useMemo(() => getRouteParam(city)?.trim() ?? "", [city]);
  const [searchQuery, setSearchQuery] = useState("");
  const [audienceFilter, setAudienceFilter] = useState<AudienceFilter>("including-friends");
  const [appliedAudienceFilter, setAppliedAudienceFilter] = useState<AudienceFilter>(
    "including-friends"
  );
  const [isFilterTransitionLoading, setIsFilterTransitionLoading] = useState(false);
  const applyAudienceFilterFrameRef = useRef<number | null>(null);
  // Controls pull-to-refresh spinner visibility.
  const [refreshing, setRefreshing] = useState(false);
  // Controls visibility of the day-filter modal.
  const [dayModalVisible, setDayModalVisible] = useState(false);
  const [dayQuickPopoverVisible, setDayQuickPopoverVisible] = useState(false);
  const [dayQuickPopoverAnchor, setDayQuickPopoverAnchor] =
    useState<FilterPillLongPressPosition | null>(null);
  // Controls visibility of the time-filter modal.
  const [timeModalVisible, setTimeModalVisible] = useState(false);
  const [timeQuickPopoverVisible, setTimeQuickPopoverVisible] = useState(false);
  const [timeQuickPopoverAnchor, setTimeQuickPopoverAnchor] =
    useState<FilterPillLongPressPosition | null>(null);
  // Snapshot timestamp used to keep paginated API responses consistent.
  const [snapshotTime, setSnapshotTime] = useState(() =>
    DateTime.now().setZone("Europe/Amsterdam").toFormat("yyyy-MM-dd'T'HH:mm:ss")
  );

  const {
    selectedShowtimeFilter,
    appliedShowtimeFilter,
    setSelectedShowtimeFilter,
    watchlistOnly,
    appliedWatchlistOnly,
    setWatchlistOnly,
    selectedDays: sharedSelectedDays,
    setSelectedDays,
    selectedTimeRanges: sharedSelectedTimeRanges,
    setSelectedTimeRanges,
  } = useSharedTabFilters();
  const isFocused = useIsFocused();
  const selectedDays = sharedSelectedDays ?? EMPTY_DAYS;
  const selectedTimeRanges = sharedSelectedTimeRanges ?? EMPTY_TIME_RANGES;
  const dayAnchorKey =
    DateTime.now().setZone("Europe/Amsterdam").startOf("day").toISODate() ?? "";
  const resolvedApiDays = useMemo(
    () => resolveDaySelectionsForApi(selectedDays),
    [dayAnchorKey, selectedDays]
  );
  const shouldShowAudienceToggle = selectedShowtimeFilter !== "all";
  const effectiveAudienceFilter: AudienceFilter = shouldShowAudienceToggle
    ? appliedAudienceFilter
    : "including-friends";
  const { data: cinemas } = useFetchCinemas();

  // React Query client used for cache updates and invalidation.
  const queryClient = useQueryClient();

  const cinemaFromList = useMemo(
    () => cinemas?.find((cinemaValue) => cinemaValue.id === cinemaId),
    [cinemaId, cinemas]
  );
  const cinemaName = routeCinemaName || cinemaFromList?.name || "Cinema";
  const cityName = routeCityName || cinemaFromList?.city.name || "";
  const topBarTitleSuffix = cityName ? `(${cityName})` : undefined;

  // Build the filter payload from current UI selections.
  const showtimesFilters = useMemo(() => {
    return {
      query: searchQuery || undefined,
      selectedCinemaIds: [cinemaId],
      days: resolvedApiDays,
      timeRanges: selectedTimeRanges.length > 0 ? selectedTimeRanges : undefined,
      selectedStatuses: getSelectedStatusesFromShowtimeFilter(appliedShowtimeFilter),
      watchlistOnly: appliedWatchlistOnly ? true : undefined,
    };
  }, [
    cinemaId,
    searchQuery,
    resolvedApiDays,
    appliedShowtimeFilter,
    selectedTimeRanges,
    appliedWatchlistOnly,
  ]);

  // Build pills with the shared tab helper so status pill visuals match the main Showtimes page exactly.
  const pillFilters = useMemo(() => {
    return buildSharedTabPillFilters({
      colors,
      selectedShowtimeFilter,
      selectedDaysCount: selectedDays.length,
      selectedTimeRangesCount: selectedTimeRanges.length,
    }).filter((filter) => CINEMA_FILTER_ID_SET.has(filter.id));
  }, [colors, selectedDays.length, selectedShowtimeFilter, selectedTimeRanges.length]);

  // Compute which filter pills should render as active.
  const activeFilterIds = useMemo<CinemaShowtimesFilterId[]>(
    () =>
      buildSharedTabActiveFilterIds({
        selectedShowtimeFilter,
        watchlistOnly,
        selectedDaysCount: selectedDays.length,
        selectedTimeRangesCount: selectedTimeRanges.length,
        isCinemaFilterActive: false,
      }).filter((id): id is CinemaShowtimesFilterId => CINEMA_FILTER_ID_SET.has(id)),
    [selectedShowtimeFilter, selectedDays.length, selectedTimeRanges.length, watchlistOnly]
  );

  // Data hooks keep this module synced with backend data and shared cache state.
  const mainShowtimesQuery = useFetchMainPageShowtimes({
    limit: 20,
    snapshotTime,
    filters: showtimesFilters,
    enabled: isFocused && effectiveAudienceFilter === "including-friends",
  });
  const myShowtimesQuery = useFetchMyShowtimes({
    limit: 20,
    snapshotTime,
    filters: showtimesFilters,
    enabled: isFocused && effectiveAudienceFilter === "only-you",
  });
  const activeShowtimesQuery =
    effectiveAudienceFilter === "only-you" ? myShowtimesQuery : mainShowtimesQuery;
  const {
    data,
    isLoading,
    isFetchingNextPage,
    isFetching,
    hasNextPage,
    fetchNextPage,
  } = activeShowtimesQuery;
  const isAudienceTransitionPending =
    shouldShowAudienceToggle && audienceFilter !== appliedAudienceFilter;
  const isAppliedFilterTransitionPending =
    selectedShowtimeFilter !== appliedShowtimeFilter ||
    watchlistOnly !== appliedWatchlistOnly ||
    isAudienceTransitionPending;

  // Flatten/derive list data for rendering efficiency.
  const showtimes = useMemo(() => data?.pages.flat() ?? [], [data]);
  const visibleShowtimes = isFilterTransitionLoading ? [] : showtimes;

  const startFilterTransitionLoading = () => {
    setIsFilterTransitionLoading(true);
  };

  const applyAudienceFilter = (next: AudienceFilter) => {
    setAudienceFilter(next);
    if (applyAudienceFilterFrameRef.current !== null) {
      cancelAnimationFrame(applyAudienceFilterFrameRef.current);
    }
    applyAudienceFilterFrameRef.current = requestAnimationFrame(() => {
      applyAudienceFilterFrameRef.current = null;
      setAppliedAudienceFilter(next);
    });
  };

  useEffect(
    () => () => {
      if (applyAudienceFilterFrameRef.current !== null) {
        cancelAnimationFrame(applyAudienceFilterFrameRef.current);
      }
    },
    []
  );

  useEffect(() => {
    if (!isFilterTransitionLoading) return;
    if (isAppliedFilterTransitionPending) return;

    const frame = requestAnimationFrame(() => {
      setIsFilterTransitionLoading(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [isAppliedFilterTransitionPending, isFilterTransitionLoading]);

  // Refresh the current dataset and reset any stale pagination state.
  const handleRefresh = async () => {
    setRefreshing(true);
    await resetInfiniteQuery(
      queryClient,
      effectiveAudienceFilter === "only-you"
        ? ["showtimes", "me", showtimesFilters]
        : ["showtimes", "main", showtimesFilters]
    );
    setSnapshotTime(DateTime.now().setZone("Europe/Amsterdam").toFormat("yyyy-MM-dd'T'HH:mm:ss"));
    setRefreshing(false);
  };

  // Request the next page when the list nears the end.
  const handleLoadMore = () => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  };

  // Handle filter pill presses and update filter state.
  const handleToggleFilter = (
    filterId: CinemaShowtimesFilterId,
    position?: FilterPillLongPressPosition
  ) => {
    if (filterId === "showtime-filter") {
      startFilterTransitionLoading();
      setSelectedShowtimeFilter(cycleSharedTabShowtimeFilter(selectedShowtimeFilter));
      return;
    }
    if (filterId === "days") {
      setDayQuickPopoverAnchor(position ?? null);
      setDayQuickPopoverVisible(true);
      return;
    }
    if (filterId === "times") {
      setTimeQuickPopoverAnchor(position ?? null);
      setTimeQuickPopoverVisible(true);
      return;
    }
    if (filterId === "watchlist-only") {
      startFilterTransitionLoading();
      setWatchlistOnly(!watchlistOnly);
      return;
    }
  };

  const handleLongPressFilter = (
    filterId: CinemaShowtimesFilterId,
    _position: FilterPillLongPressPosition
  ) => {
    if (filterId === "days") {
      setDayModalVisible(true);
      return true;
    }
    if (filterId === "times") {
      setTimeModalVisible(true);
      return true;
    }
    return false;
  };

  // Render/output using the state and derived values prepared above.
  return (
    <>
      <ShowtimesScreen
        topBarTitle={cinemaName}
        topBarTitleSuffix={topBarTitleSuffix}
        topBarShowBackButton
        showtimes={visibleShowtimes}
        isLoading={isLoading || isFilterTransitionLoading}
        isFetching={isFetching || isFilterTransitionLoading}
        isFetchingNextPage={isFetchingNextPage}
        hasNextPage={hasNextPage}
        onLoadMore={handleLoadMore}
        refreshing={refreshing}
        onRefresh={handleRefresh}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        filters={pillFilters}
        activeFilterIds={activeFilterIds}
        onToggleFilter={handleToggleFilter}
        onLongPressFilter={handleLongPressFilter}
        audienceToggle={
          shouldShowAudienceToggle
            ? {
                value: audienceFilter,
                onChange: (value) => {
                  startFilterTransitionLoading();
                  applyAudienceFilter(value);
                },
              }
            : undefined
        }
        emptyText="No showtimes for this cinema"
      />
      <DayQuickPopover
        visible={dayQuickPopoverVisible}
        anchor={dayQuickPopoverAnchor}
        onClose={() => setDayQuickPopoverVisible(false)}
        selectedDays={selectedDays}
        onChange={setSelectedDays}
        onOpenModal={() => setDayModalVisible(true)}
      />
      <TimeQuickPopover
        visible={timeQuickPopoverVisible}
        anchor={timeQuickPopoverAnchor}
        onClose={() => setTimeQuickPopoverVisible(false)}
        selectedTimeRanges={selectedTimeRanges}
        onChange={setSelectedTimeRanges}
        onOpenModal={() => setTimeModalVisible(true)}
      />
      <DayFilterModal
        visible={dayModalVisible}
        onClose={() => setDayModalVisible(false)}
        selectedDays={selectedDays}
        onChange={setSelectedDays}
      />
      <TimeFilterModal
        visible={timeModalVisible}
        onClose={() => setTimeModalVisible(false)}
        selectedTimeRanges={selectedTimeRanges}
        onChange={setSelectedTimeRanges}
      />
    </>
  );
}
