/**
 * Expo Router screen/module for (tabs) / agenda. It controls navigation and screen-level state for this route.
 */
import { useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { useQueryClient } from '@tanstack/react-query';
import type { GoingStatus } from 'shared';
import { useFetchMyShowtimes } from 'shared/hooks/useFetchMyShowtimes';
import { useSessionCinemaSelections } from 'shared/hooks/useSessionCinemaSelections';

import ShowtimesScreen from '@/components/showtimes/ShowtimesScreen';
import { resetInfiniteQuery } from '@/utils/reset-infinite-query';

// Filter pill definitions rendered in the top filter row.
const BASE_FILTERS = [
  { id: 'going', label: 'Going Only' },
] as const;

type AgendaFilterId = (typeof BASE_FILTERS)[number]['id'];

export default function AgendaScreen() {
  // Read flow: local state and data hooks first, then handlers, then the JSX screen.
  const [searchQuery, setSearchQuery] = useState('');
  // Tracks which filter pills are toggled on (multi-select).
  const [activeFilterIds, setActiveFilterIds] = useState<AgendaFilterId[]>([]);
  // Controls pull-to-refresh spinner visibility.
  const [refreshing, setRefreshing] = useState(false);
  // Snapshot timestamp used to keep paginated API responses consistent.
  const [snapshotTime, setSnapshotTime] = useState(() =>
    DateTime.now().setZone('Europe/Amsterdam').toFormat("yyyy-MM-dd'T'HH:mm:ss")
  );

  const { selections: sessionCinemaIds } = useSessionCinemaSelections();

  // React Query client used for cache updates and invalidation.
  const queryClient = useQueryClient();

  // Build the filter payload from current UI selections.
  const showtimesFilters = useMemo(() => {
    const selectedStatuses: GoingStatus[] | undefined = activeFilterIds.includes('going')
      ? ['GOING']
      : undefined;

    return {
      query: searchQuery || undefined,
      selectedCinemaIds: sessionCinemaIds,
      selectedStatuses,
    };
  }, [searchQuery, activeFilterIds, sessionCinemaIds]);

  // Data hooks keep this module synced with backend data and shared cache state.
  const {
    data,
    isLoading,
    isFetchingNextPage,
    isFetching,
    hasNextPage,
    fetchNextPage,
  } = useFetchMyShowtimes({
    limit: 20,
    snapshotTime,
    filters: showtimesFilters,
  });

  // Flatten/derive list data for rendering efficiency.
  const showtimes = useMemo(() => data?.pages.flat() ?? [], [data]);

  // Refresh the current dataset and reset any stale pagination state.
  const handleRefresh = async () => {
    setRefreshing(true);
    await resetInfiniteQuery(queryClient, ['showtimes', 'me', showtimesFilters]);
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
  const handleToggleFilter = (filterId: AgendaFilterId) => {
    setActiveFilterIds((prev) => {
      const isActive = prev.includes(filterId);
      return isActive ? prev.filter((id) => id !== filterId) : [...prev, filterId];
    });
  };

  // Render/output using the state and derived values prepared above.
  return (
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
      filters={BASE_FILTERS}
      activeFilterIds={activeFilterIds}
      onToggleFilter={handleToggleFilter}
      emptyText="No showtimes in your agenda"
    />
  );
}
