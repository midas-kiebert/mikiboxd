/**
 * Expo Router screen/module for (tabs) / index. It controls navigation and screen-level state for this route.
 */
import { useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { useQueryClient } from '@tanstack/react-query';
import { useIsFocused } from '@react-navigation/native';
import { useFetchMainPageShowtimes } from 'shared/hooks/useFetchMainPageShowtimes';
import { useFetchSelectedCinemas } from 'shared/hooks/useFetchSelectedCinemas';

import CinemaFilterModal from '@/components/filters/CinemaFilterModal';
import DayFilterModal from '@/components/filters/DayFilterModal';
import FilterPresetsModal, {
  type PageFilterPresetState,
} from '@/components/filters/FilterPresetsModal';
import TimeFilterModal from '@/components/filters/TimeFilterModal';
import { resolveDaySelectionsForApi } from '@/components/filters/day-filter-utils';
import {
  SHARED_TAB_FILTER_PRESET_SCOPE,
  buildSharedTabActiveFilterIds,
  buildSharedTabPillFilters,
  cycleSharedTabShowtimeFilter,
  getSelectedStatusesFromShowtimeFilter,
  toSharedTabShowtimeFilter,
  type SharedTabFilterId,
} from '@/components/filters/shared-tab-filters';
import ShowtimesScreen from '@/components/showtimes/ShowtimesScreen';
import { isCinemaSelectionDifferentFromPreferred } from '@/utils/cinema-selection';
import { resetInfiniteQuery } from '@/utils/reset-infinite-query';
import { useThemeColors } from '@/hooks/use-theme-color';
import { useSharedTabFilters } from '@/hooks/useSharedTabFilters';

export default function MainShowtimesScreen() {
  // Read flow: local state and data hooks first, then handlers, then the JSX screen.
  const colors = useThemeColors();
  const [searchQuery, setSearchQuery] = useState('');
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

  const {
    selectedShowtimeFilter,
    setSelectedShowtimeFilter,
    watchlistOnly,
    setWatchlistOnly,
    sessionCinemaIds,
    selectedDays,
    setSelectedDays,
    selectedTimeRanges,
    setSelectedTimeRanges,
  } = useSharedTabFilters();
  const isFocused = useIsFocused();
  const { data: preferredCinemaIds } = useFetchSelectedCinemas();
  const dayAnchorKey =
    DateTime.now().setZone('Europe/Amsterdam').startOf('day').toISODate() ?? '';
  const resolvedApiDays = useMemo(
    () => resolveDaySelectionsForApi(selectedDays),
    [dayAnchorKey, selectedDays]
  );

  // React Query client used for cache updates and invalidation.
  const queryClient = useQueryClient();

  // Build the filter payload from current UI selections.
  const showtimesFilters = useMemo(() => {
    return {
      query: searchQuery || undefined,
      selectedCinemaIds: sessionCinemaIds,
      days: resolvedApiDays,
      timeRanges: selectedTimeRanges.length > 0 ? selectedTimeRanges : undefined,
      selectedStatuses: getSelectedStatusesFromShowtimeFilter(selectedShowtimeFilter),
      watchlistOnly: watchlistOnly ? true : undefined,
    };
  }, [
    searchQuery,
    selectedShowtimeFilter,
    resolvedApiDays,
    selectedTimeRanges,
    sessionCinemaIds,
    watchlistOnly,
  ]);

  const currentPresetFilters = useMemo<PageFilterPresetState>(
    () => ({
      selected_showtime_filter: selectedShowtimeFilter,
      watchlist_only: watchlistOnly,
      days: selectedDays.length > 0 ? selectedDays : null,
      time_ranges: selectedTimeRanges.length > 0 ? selectedTimeRanges : null,
    }),
    [selectedShowtimeFilter, watchlistOnly, selectedDays, selectedTimeRanges]
  );

  // Build shared filter pills used by both Movies and Showtimes tabs.
  const pillFilters = useMemo(
    () =>
      buildSharedTabPillFilters({
        colors,
        selectedShowtimeFilter,
        selectedDaysCount: selectedDays.length,
        selectedTimeRangesCount: selectedTimeRanges.length,
      }),
    [colors, selectedDays.length, selectedShowtimeFilter, selectedTimeRanges.length]
  );

  // Cinema pill should only be active when current session differs from preferred cinemas.
  const isCinemaFilterActive = useMemo(
    () =>
      isCinemaSelectionDifferentFromPreferred({
        sessionCinemaIds,
        preferredCinemaIds,
      }),
    [sessionCinemaIds, preferredCinemaIds]
  );

  // Compute shared active filter ids used by both Movies and Showtimes tabs.
  const activeFilterIds = useMemo<SharedTabFilterId[]>(
    () =>
      buildSharedTabActiveFilterIds({
        selectedShowtimeFilter,
        watchlistOnly,
        selectedDaysCount: selectedDays.length,
        selectedTimeRangesCount: selectedTimeRanges.length,
        isCinemaFilterActive,
      }),
    [selectedShowtimeFilter, watchlistOnly, selectedDays.length, selectedTimeRanges.length, isCinemaFilterActive]
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
    enabled: isFocused,
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
  const handleToggleFilter = (filterId: SharedTabFilterId) => {
    if (filterId === 'showtime-filter') {
      setSelectedShowtimeFilter(cycleSharedTabShowtimeFilter(selectedShowtimeFilter));
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
      setWatchlistOnly(!watchlistOnly);
      return;
    }
  };

  const handleApplyPreset = (filters: PageFilterPresetState) => {
    setSelectedShowtimeFilter(toSharedTabShowtimeFilter(filters.selected_showtime_filter));
    setWatchlistOnly(Boolean(filters.watchlist_only));
    setSelectedDays(filters.days ?? []);
    setSelectedTimeRanges(filters.time_ranges ?? []);
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
        onChange={setSelectedDays}
      />
      <TimeFilterModal
        visible={timeModalVisible}
        onClose={() => setTimeModalVisible(false)}
        selectedTimeRanges={selectedTimeRanges}
        onChange={setSelectedTimeRanges}
      />
      <FilterPresetsModal
        visible={presetModalVisible}
        onClose={() => setPresetModalVisible(false)}
        scope={SHARED_TAB_FILTER_PRESET_SCOPE}
        currentFilters={currentPresetFilters}
        onApply={handleApplyPreset}
      />
    </>
  );
}
