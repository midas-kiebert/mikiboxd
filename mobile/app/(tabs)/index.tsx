/**
 * Expo Router screen/module for (tabs) / index. It controls navigation and screen-level state for this route.
 */
import { useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { useQueryClient } from '@tanstack/react-query';
import type { GoingStatus } from 'shared';
import { useFetchMainPageShowtimes } from 'shared/hooks/useFetchMainPageShowtimes';
import { useFetchSelectedCinemas } from 'shared/hooks/useFetchSelectedCinemas';
import { useSessionCinemaSelections } from 'shared/hooks/useSessionCinemaSelections';
import { useSessionDaySelections } from 'shared/hooks/useSessionDaySelections';
import { useSessionTimeRangeSelections } from 'shared/hooks/useSessionTimeRangeSelections';

import CinemaFilterModal from '@/components/filters/CinemaFilterModal';
import DayFilterModal from '@/components/filters/DayFilterModal';
import FilterPresetsModal, {
  type PageFilterPresetState,
} from '@/components/filters/FilterPresetsModal';
import TimeFilterModal from '@/components/filters/TimeFilterModal';
import ShowtimesScreen from '@/components/showtimes/ShowtimesScreen';
import { isCinemaSelectionDifferentFromPreferred } from '@/utils/cinema-selection';
import { resetInfiniteQuery } from '@/utils/reset-infinite-query';
import { useThemeColors } from '@/hooks/use-theme-color';

// Filter pill definitions rendered in the top filter row.
const BASE_FILTERS = [
  { id: 'showtime-filter', label: 'Interested' },
  { id: 'watchlist-only', label: 'Watchlist Only' },
  { id: 'cinemas', label: 'Cinemas' },
  { id: 'days', label: 'Days' },
  { id: 'times', label: 'Times' },
  { id: 'presets', label: 'Presets' },
] as const;

type MainShowtimesFilterId = (typeof BASE_FILTERS)[number]['id'];
type ShowtimeFilter = 'all' | 'interested' | 'going';

const EMPTY_DAYS: string[] = [];
const EMPTY_TIME_RANGES: string[] = [];

export default function MainShowtimesScreen() {
  // Read flow: local state and data hooks first, then handlers, then the JSX screen.
  const colors = useThemeColors();
  const [searchQuery, setSearchQuery] = useState('');
  // Tracks the selected showtime-status mode (interested / going / all).
  const [selectedShowtimeFilter, setSelectedShowtimeFilter] =
    useState<ShowtimeFilter>('interested');
  // Whether the list should be limited to movies in the user's watchlist.
  const [watchlistOnly, setWatchlistOnly] = useState(false);
  // Controls pull-to-refresh spinner visibility.
  const [refreshing, setRefreshing] = useState(false);
  // Controls visibility of the cinema-filter modal.
  const [cinemaModalVisible, setCinemaModalVisible] = useState(false);
  // Controls visibility of the day-filter modal.
  const [dayModalVisible, setDayModalVisible] = useState(false);
  // Controls visibility of the time-filter modal.
  const [timeModalVisible, setTimeModalVisible] = useState(false);
  // Controls visibility of the filter-presets modal.
  const [presetModalVisible, setPresetModalVisible] = useState(false);
  // Snapshot timestamp used to keep paginated API responses consistent.
  const [snapshotTime, setSnapshotTime] = useState(() =>
    DateTime.now().setZone('Europe/Amsterdam').toFormat("yyyy-MM-dd'T'HH:mm:ss")
  );

  const { selections: sessionCinemaIds, setSelections: setSessionCinemaIds } =
    useSessionCinemaSelections();
  const { data: preferredCinemaIds } = useFetchSelectedCinemas();
  const { selections: sessionDays, setSelections: setSessionDays } = useSessionDaySelections();
  const { selections: sessionTimeRanges, setSelections: setSessionTimeRanges } =
    useSessionTimeRangeSelections();
  const selectedDays = sessionDays ?? EMPTY_DAYS;
  const selectedTimeRanges = sessionTimeRanges ?? EMPTY_TIME_RANGES;

  // React Query client used for cache updates and invalidation.
  const queryClient = useQueryClient();

  // Build the filter payload from current UI selections.
  const showtimesFilters = useMemo(() => {
    // This local variable annotation gives `selectedStatuses` the correct type
    // without needing an `as ...` cast on the ternary expression.
    const selectedStatuses: GoingStatus[] | undefined =
      selectedShowtimeFilter === 'all'
        ? undefined
        : selectedShowtimeFilter === 'going'
          ? ['GOING']
          : ['GOING', 'INTERESTED'];

    return {
      query: searchQuery || undefined,
      selectedCinemaIds: sessionCinemaIds,
      days: selectedDays.length > 0 ? selectedDays : undefined,
      timeRanges: selectedTimeRanges.length > 0 ? selectedTimeRanges : undefined,
      selectedStatuses,
      watchlistOnly: watchlistOnly ? true : undefined,
    };
  }, [
    searchQuery,
    selectedShowtimeFilter,
    selectedDays,
    selectedTimeRanges,
    sessionCinemaIds,
    watchlistOnly,
  ]);

  const currentPresetFilters = useMemo<PageFilterPresetState>(
    () => ({
      selected_showtime_filter: selectedShowtimeFilter,
      watchlist_only: watchlistOnly,
      selected_cinema_ids: sessionCinemaIds ?? null,
      days: selectedDays.length > 0 ? selectedDays : null,
      time_ranges: selectedTimeRanges.length > 0 ? selectedTimeRanges : null,
    }),
    [
      selectedShowtimeFilter,
      watchlistOnly,
      sessionCinemaIds,
      selectedDays,
      selectedTimeRanges,
    ]
  );

  // Only decorate the day pill label when the filter is actually active.
  const pillFilters = useMemo(() => {
    return BASE_FILTERS.map((filter) => {
      if (filter.id === 'showtime-filter') {
        const label =
          selectedShowtimeFilter === 'all'
            ? 'Any Status'
            : selectedShowtimeFilter === 'going'
              ? 'Going'
              : 'Interested';
        return {
          ...filter,
          label,
          activeBackgroundColor:
            selectedShowtimeFilter === 'going'
              ? colors.green.primary
              : selectedShowtimeFilter === 'interested'
                ? colors.orange.primary
                : undefined,
          activeTextColor:
            selectedShowtimeFilter === 'going'
              ? colors.green.secondary
              : selectedShowtimeFilter === 'interested'
                ? colors.orange.secondary
                : undefined,
          activeBorderColor:
            selectedShowtimeFilter === 'going'
              ? colors.green.secondary
              : selectedShowtimeFilter === 'interested'
                ? colors.orange.secondary
                : undefined,
        };
      }
      if (filter.id === 'days' && selectedDays.length > 0) {
        return { ...filter, label: `Days (${selectedDays.length})` };
      }
      if (filter.id === 'times' && selectedTimeRanges.length > 0) {
        return { ...filter, label: `Times (${selectedTimeRanges.length})` };
      }
      return filter;
    });
  }, [colors, selectedDays.length, selectedShowtimeFilter, selectedTimeRanges.length]);

  // Cinema pill should only be active when current session differs from preferred cinemas.
  const isCinemaFilterActive = useMemo(
    () =>
      isCinemaSelectionDifferentFromPreferred({
        sessionCinemaIds,
        preferredCinemaIds,
      }),
    [sessionCinemaIds, preferredCinemaIds]
  );

  // Compute which filter pills should render as active.
  const activeFilterIds = useMemo<MainShowtimesFilterId[]>(
    () => {
      const active: MainShowtimesFilterId[] = [];
      if (selectedShowtimeFilter !== 'all') {
        active.push('showtime-filter');
      }
      if (selectedDays.length > 0) {
        active.push('days');
      }
      if (selectedTimeRanges.length > 0) {
        active.push('times');
      }
      if (isCinemaFilterActive) {
        active.push('cinemas');
      }
      if (watchlistOnly) {
        active.push('watchlist-only');
      }
      return active;
    },
    [
      selectedShowtimeFilter,
      selectedDays.length,
      selectedTimeRanges.length,
      isCinemaFilterActive,
      watchlistOnly,
    ]
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
    await resetInfiniteQuery(queryClient, ['showtimes', 'main', showtimesFilters]);
    setSnapshotTime(DateTime.now().setZone('Europe/Amsterdam').toFormat("yyyy-MM-dd'T'HH:mm:ss"));
    setRefreshing(false);
  };

  // Request the next page when the list nears the end.
  const handleLoadMore = () => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  };

  // Handle filter pill presses and update filter state.
  const handleToggleFilter = (filterId: MainShowtimesFilterId) => {
    if (filterId === 'showtime-filter') {
      // Tap cycles all -> interested -> going -> all for quick triaging.
      setSelectedShowtimeFilter((prev) =>
        prev === 'all' ? 'interested' : prev === 'interested' ? 'going' : 'all'
      );
      return;
    }
    if (filterId === 'cinemas') {
      setCinemaModalVisible(true);
      return;
    }
    if (filterId === 'days') {
      setDayModalVisible(true);
      return;
    }
    if (filterId === 'times') {
      setTimeModalVisible(true);
      return;
    }
    if (filterId === 'presets') {
      setPresetModalVisible(true);
      return;
    }
    if (filterId === 'watchlist-only') {
      setWatchlistOnly((prev) => !prev);
      return;
    }
  };

  const handleApplyPreset = (filters: PageFilterPresetState) => {
    const showtimeFilter = filters.selected_showtime_filter;
    setSelectedShowtimeFilter(
      showtimeFilter === 'going' || showtimeFilter === 'interested' || showtimeFilter === 'all'
        ? showtimeFilter
        : 'all'
    );
    setWatchlistOnly(Boolean(filters.watchlist_only));
    setSessionCinemaIds(filters.selected_cinema_ids ?? undefined);
    setSessionDays(filters.days ?? []);
    setSessionTimeRanges(filters.time_ranges ?? []);
  };

  // Render/output using the state and derived values prepared above.
  return (
    <>
      <ShowtimesScreen
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
        emptyText="No showtimes found"
      />
      <CinemaFilterModal
        visible={cinemaModalVisible}
        onClose={() => setCinemaModalVisible(false)}
      />
      <DayFilterModal
        visible={dayModalVisible}
        onClose={() => setDayModalVisible(false)}
        selectedDays={selectedDays}
        onChange={setSessionDays}
      />
      <TimeFilterModal
        visible={timeModalVisible}
        onClose={() => setTimeModalVisible(false)}
        selectedTimeRanges={selectedTimeRanges}
        onChange={setSessionTimeRanges}
      />
      <FilterPresetsModal
        visible={presetModalVisible}
        onClose={() => setPresetModalVisible(false)}
        scope="SHOWTIMES"
        currentFilters={currentPresetFilters}
        onApply={handleApplyPreset}
      />
    </>
  );
}
