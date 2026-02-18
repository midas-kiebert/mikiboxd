/**
 * Expo Router screen/module for cinema-showtimes / [id]. It controls navigation and screen-level state for this route.
 */
import { useMemo, useState } from "react";
import { DateTime } from "luxon";
import { useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import type { GoingStatus } from "shared";
import { useFetchMainPageShowtimes } from "shared/hooks/useFetchMainPageShowtimes";
import { useSessionDaySelections } from "shared/hooks/useSessionDaySelections";
import { useFetchCinemas } from "shared/hooks/useFetchCinemas";

import ShowtimesScreen from "@/components/showtimes/ShowtimesScreen";
import DayFilterModal from "@/components/filters/DayFilterModal";
import { resetInfiniteQuery } from "@/utils/reset-infinite-query";

// Filter pill definitions rendered in the top filter row.
const BASE_FILTERS = [
  { id: "all", label: "All Showtimes" },
  { id: "interested", label: "Interested" },
  { id: "going", label: "Going" },
  { id: "watchlist-only", label: "Watchlist Only" },
  { id: "days", label: "Days" },
] as const;

type CinemaShowtimesFilterId = (typeof BASE_FILTERS)[number]["id"];
type ShowtimeStatusFilterId = Exclude<CinemaShowtimesFilterId, "days" | "watchlist-only">;

const EMPTY_DAYS: string[] = [];

const getRouteParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export default function CinemaShowtimesScreen() {
  // Read flow: local state and data hooks first, then handlers, then the JSX screen.
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
  // Tracks the selected showtime-status mode (interested / going / all).
  const [selectedShowtimeFilter, setSelectedShowtimeFilter] =
    useState<ShowtimeStatusFilterId>("all");
  // Whether the list should be limited to movies in the user's watchlist.
  const [watchlistOnly, setWatchlistOnly] = useState(false);
  // Controls pull-to-refresh spinner visibility.
  const [refreshing, setRefreshing] = useState(false);
  // Controls visibility of the day-filter modal.
  const [dayModalVisible, setDayModalVisible] = useState(false);
  // Snapshot timestamp used to keep paginated API responses consistent.
  const [snapshotTime, setSnapshotTime] = useState(() =>
    DateTime.now().setZone("Europe/Amsterdam").toFormat("yyyy-MM-dd'T'HH:mm:ss")
  );

  const { selections: sessionDays, setSelections: setSessionDays } = useSessionDaySelections();
  const selectedDays = sessionDays ?? EMPTY_DAYS;
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
    const selectedStatuses: GoingStatus[] | undefined =
      selectedShowtimeFilter === "all"
        ? undefined
        : selectedShowtimeFilter === "going"
          ? ["GOING"]
          : ["GOING", "INTERESTED"];

    return {
      query: searchQuery || undefined,
      selectedCinemaIds: [cinemaId],
      days: selectedDays.length > 0 ? selectedDays : undefined,
      selectedStatuses,
      watchlistOnly: watchlistOnly ? true : undefined,
    };
  }, [cinemaId, searchQuery, selectedDays, selectedShowtimeFilter, watchlistOnly]);

  // Only decorate the day pill label when the filter is actually active.
  const pillFilters = useMemo(() => {
    if (selectedDays.length === 0) return BASE_FILTERS;
    return BASE_FILTERS.map((filter) =>
      filter.id === "days"
        ? { ...filter, label: `Days (${selectedDays.length})` }
        : filter
    );
  }, [selectedDays.length]);

  // Compute which filter pills should render as active.
  const activeFilterIds = useMemo<CinemaShowtimesFilterId[]>(
    () => {
      const active: CinemaShowtimesFilterId[] = [selectedShowtimeFilter];
      if (selectedDays.length > 0) {
        active.push("days");
      }
      if (watchlistOnly) {
        active.push("watchlist-only");
      }
      return active;
    },
    [selectedShowtimeFilter, selectedDays.length, watchlistOnly]
  );

  // Data hooks keep this module synced with backend data and shared cache state.
  const {
    data,
    isLoading,
    isFetchingNextPage,
    isFetching,
    hasNextPage,
    fetchNextPage,
  } = useFetchMainPageShowtimes({
    limit: 20,
    snapshotTime,
    filters: showtimesFilters,
  });

  // Flatten/derive list data for rendering efficiency.
  const showtimes = useMemo(() => data?.pages.flat() ?? [], [data]);

  // Refresh the current dataset and reset any stale pagination state.
  const handleRefresh = async () => {
    setRefreshing(true);
    await resetInfiniteQuery(queryClient, ["showtimes", "main", showtimesFilters]);
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
  const handleToggleFilter = (filterId: CinemaShowtimesFilterId) => {
    if (filterId === "days") {
      setDayModalVisible(true);
      return;
    }
    if (filterId === "watchlist-only") {
      setWatchlistOnly((prev) => !prev);
      return;
    }
    setSelectedShowtimeFilter(filterId);
  };

  // Render/output using the state and derived values prepared above.
  return (
    <>
      <ShowtimesScreen
        topBarTitle={cinemaName}
        topBarTitleSuffix={topBarTitleSuffix}
        topBarShowBackButton
        showtimes={showtimes}
        isLoading={isLoading}
        isFetching={isFetching}
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
        emptyText="No showtimes for this cinema"
      />
      <DayFilterModal
        visible={dayModalVisible}
        onClose={() => setDayModalVisible(false)}
        selectedDays={selectedDays}
        onChange={setSessionDays}
      />
    </>
  );
}
