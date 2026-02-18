/**
 * Expo Router screen/module for (tabs) / index. It controls navigation and screen-level state for this route.
 */
import { useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { useQueryClient } from '@tanstack/react-query';
import type { GoingStatus } from 'shared';
import { useFetchMainPageShowtimes } from 'shared/hooks/useFetchMainPageShowtimes';
import { useSessionCinemaSelections } from 'shared/hooks/useSessionCinemaSelections';
import { useSessionDaySelections } from 'shared/hooks/useSessionDaySelections';

import CinemaFilterModal from '@/components/filters/CinemaFilterModal';
import DayFilterModal from '@/components/filters/DayFilterModal';
import ShowtimesScreen from '@/components/showtimes/ShowtimesScreen';
import { resetInfiniteQuery } from '@/utils/reset-infinite-query';

// Filter pill definitions rendered in the top filter row.
const BASE_FILTERS = [
  { id: 'interested', label: 'Interested' },
  { id: 'going', label: 'Going' },
  { id: 'all', label: 'All Showtimes' },
  { id: 'cinemas', label: 'Cinemas' },
  { id: 'days', label: 'Days' },
] as const;

type MainShowtimesFilterId = (typeof BASE_FILTERS)[number]['id'];

type ShowtimeStatusFilterId = Exclude<MainShowtimesFilterId, 'cinemas' | 'days'>;

const EMPTY_DAYS: string[] = [];

export default function MainShowtimesScreen() {
  // Read flow: local state and data hooks first, then handlers, then the JSX screen.
  const [searchQuery, setSearchQuery] = useState('');
  // Tracks the selected showtime-status mode (interested / going / all).
  const [selectedShowtimeFilter, setSelectedShowtimeFilter] =
    useState<ShowtimeStatusFilterId>('interested');
  // Controls pull-to-refresh spinner visibility.
  const [refreshing, setRefreshing] = useState(false);
  // Controls visibility of the cinema-filter modal.
  const [cinemaModalVisible, setCinemaModalVisible] = useState(false);
  // Controls visibility of the day-filter modal.
  const [dayModalVisible, setDayModalVisible] = useState(false);
  // Snapshot timestamp used to keep paginated API responses consistent.
  const [snapshotTime, setSnapshotTime] = useState(() =>
    DateTime.now().setZone('Europe/Amsterdam').toFormat("yyyy-MM-dd'T'HH:mm:ss")
  );

  const { selections: sessionCinemaIds } = useSessionCinemaSelections();
  const { selections: sessionDays, setSelections: setSessionDays } = useSessionDaySelections();
  const selectedDays = sessionDays ?? EMPTY_DAYS;

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
      selectedStatuses,
    };
  }, [searchQuery, sessionCinemaIds, selectedDays, selectedShowtimeFilter]);

  // Only decorate the day pill label when the filter is actually active.
  const pillFilters = useMemo(() => {
    if (selectedDays.length === 0) return BASE_FILTERS;
    return BASE_FILTERS.map((filter) =>
      filter.id === 'days'
        ? { ...filter, label: `Days (${selectedDays.length})` }
        : filter
    );
  }, [selectedDays.length]);

  // Compute which filter pills should render as active.
  const activeFilterIds = useMemo<MainShowtimesFilterId[]>(
    () => {
      const active: MainShowtimesFilterId[] = [selectedShowtimeFilter];
      if (selectedDays.length > 0) {
        active.push('days');
      }
      if ((sessionCinemaIds?.length ?? 0) > 0) {
        active.push('cinemas');
      }
      return active;
    },
    [selectedShowtimeFilter, selectedDays.length, sessionCinemaIds]
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
    if (filterId === 'cinemas') {
      setCinemaModalVisible(true);
      return;
    }
    if (filterId === 'days') {
      setDayModalVisible(true);
      return;
    }
    setSelectedShowtimeFilter(filterId);
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
    </>
  );
}
