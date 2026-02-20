/**
 * Expo Router screen/module for friend-showtimes / [id]. It controls navigation and screen-level state for this route.
 */
import { useMemo, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { DateTime } from 'luxon';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { UsersService, type GoingStatus } from 'shared';
import { useFetchUserShowtimes } from 'shared/hooks/useFetchUserShowtimes';
import { useSessionCinemaSelections } from 'shared/hooks/useSessionCinemaSelections';
import { useSessionTimeRangeSelections } from 'shared/hooks/useSessionTimeRangeSelections';

import ShowtimesScreen from '@/components/showtimes/ShowtimesScreen';
import TimeFilterModal from '@/components/filters/TimeFilterModal';
import { resetInfiniteQuery } from '@/utils/reset-infinite-query';

// Filter pill definitions rendered in the top filter row.
const BASE_FILTERS = [
  { id: 'going', label: 'Going Only' },
  { id: 'watchlist-only', label: 'Watchlist Only' },
  { id: 'times', label: 'Times' },
] as const;

type FriendAgendaFilterId = (typeof BASE_FILTERS)[number]['id'];

const getRouteParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const getFriendTitle = (displayName: string | null | undefined) => {
  const trimmedDisplayName = displayName?.trim();
  if (trimmedDisplayName) return trimmedDisplayName;
  return 'Agenda';
};

export default function FriendShowtimesScreen() {
  // Read flow: local state and data hooks first, then handlers, then the JSX screen.
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const userId = useMemo(() => getRouteParam(id), [id]);
  const [searchQuery, setSearchQuery] = useState('');
  // Tracks which filter pills are toggled on (multi-select).
  const [activeFilterIds, setActiveFilterIds] = useState<FriendAgendaFilterId[]>([]);
  // Controls pull-to-refresh spinner visibility.
  const [refreshing, setRefreshing] = useState(false);
  // Controls visibility of the time-filter modal.
  const [timeModalVisible, setTimeModalVisible] = useState(false);
  // Snapshot timestamp used to keep paginated API responses consistent.
  const [snapshotTime, setSnapshotTime] = useState(() =>
    DateTime.now().setZone('Europe/Amsterdam').toFormat("yyyy-MM-dd'T'HH:mm:ss")
  );

  const { selections: sessionCinemaIds } = useSessionCinemaSelections();
  const { selections: sessionTimeRanges, setSelections: setSessionTimeRanges } =
    useSessionTimeRangeSelections();
  const selectedTimeRanges = sessionTimeRanges ?? [];

  // React Query client used for cache updates and invalidation.
  const queryClient = useQueryClient();

  // Data hooks keep this module synced with backend data and shared cache state.
  const { data: friend } = useQuery({
    queryKey: ['user', userId],
    enabled: !!userId,
    queryFn: () => UsersService.getUser({ userId: userId! }),
  });

  const topBarTitle = useMemo(
    () => (friend ? getFriendTitle(friend.display_name) : 'Agenda'),
    [friend]
  );

  // Build the filter payload from current UI selections.
  const showtimesFilters = useMemo(() => {
    const selectedStatuses: GoingStatus[] | undefined = activeFilterIds.includes('going')
      ? ['GOING']
      : undefined;
    const watchlistOnly = activeFilterIds.includes('watchlist-only');

    return {
      query: searchQuery || undefined,
      selectedCinemaIds: sessionCinemaIds,
      timeRanges: selectedTimeRanges.length > 0 ? selectedTimeRanges : undefined,
      selectedStatuses,
      watchlistOnly: watchlistOnly ? true : undefined,
    };
  }, [activeFilterIds, searchQuery, selectedTimeRanges, sessionCinemaIds]);

  // Data hooks keep this module synced with backend data and shared cache state.
  const {
    data,
    isLoading,
    isFetchingNextPage,
    isFetching,
    hasNextPage,
    fetchNextPage,
  } = useFetchUserShowtimes({
    limit: 20,
    snapshotTime,
    userId: userId ?? '',
    filters: showtimesFilters,
    enabled: !!userId,
  });

  // Flatten/derive list data for rendering efficiency.
  const showtimes = useMemo(() => data?.pages.flat() ?? [], [data]);

  // Refresh the current dataset and reset any stale pagination state.
  const handleRefresh = async () => {
    if (!userId) return;
    setRefreshing(true);
    await resetInfiniteQuery(queryClient, ['showtimes', 'user', userId, showtimesFilters]);
    setSnapshotTime(DateTime.now().setZone('Europe/Amsterdam').toFormat("yyyy-MM-dd'T'HH:mm:ss"));
    setRefreshing(false);
  };

  // Request the next page when the list nears the end.
  const handleLoadMore = () => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  };

  // Handle filter pill presses and update active filter state.
  const handleToggleFilter = (filterId: FriendAgendaFilterId) => {
    if (filterId === 'times') {
      setTimeModalVisible(true);
      return;
    }
    setActiveFilterIds((prev) => {
      const isActive = prev.includes(filterId);
      return isActive ? prev.filter((idValue) => idValue !== filterId) : [...prev, filterId];
    });
  };

  const pillFilters = useMemo(
    () =>
      BASE_FILTERS.map((filter) =>
        filter.id === 'times' && selectedTimeRanges.length > 0
          ? { ...filter, label: `Times (${selectedTimeRanges.length})` }
          : filter
      ),
    [selectedTimeRanges.length]
  );

  const highlightedFilterIds = useMemo(() => {
    const active = [...activeFilterIds];
    if (selectedTimeRanges.length > 0) {
      active.push('times');
    }
    return active;
  }, [activeFilterIds, selectedTimeRanges.length]);

  // Render/output using the state and derived values prepared above.
  return (
    <>
      <ShowtimesScreen
        topBarTitle={topBarTitle}
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
        activeFilterIds={highlightedFilterIds}
        onToggleFilter={handleToggleFilter}
        emptyText="No showtimes in this agenda"
      />
      <TimeFilterModal
        visible={timeModalVisible}
        onClose={() => setTimeModalVisible(false)}
        selectedTimeRanges={selectedTimeRanges}
        onChange={setSessionTimeRanges}
      />
    </>
  );
}
