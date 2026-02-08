import { useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { useQueryClient } from '@tanstack/react-query';
import { useFetchMainPageShowtimes } from 'shared/hooks/useFetchMainPageShowtimes';
import { useSessionCinemaSelections } from 'shared/hooks/useSessionCinemaSelections';

import ShowtimesScreen from '@/components/showtimes/ShowtimesScreen';
import { resetInfiniteQuery } from '@/utils/reset-infinite-query';

const BASE_FILTERS = [
  { id: '1', label: 'All Showtimes' },
  { id: '2', label: 'Going' },
  { id: '3', label: 'Interested' },
];

export default function MainShowtimesScreen() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFilter, setSelectedFilter] = useState('1');
  const [refreshing, setRefreshing] = useState(false);
  const [snapshotTime, setSnapshotTime] = useState(() =>
    DateTime.now().setZone('Europe/Amsterdam').toFormat("yyyy-MM-dd'T'HH:mm:ss")
  );

  const { selections: sessionCinemaIds } = useSessionCinemaSelections();

  const queryClient = useQueryClient();

  const showtimesFilters = useMemo(
    () => ({
      selectedCinemaIds: sessionCinemaIds,
    }),
    [sessionCinemaIds]
  );

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

  const showtimes = data?.pages.flat() ?? [];

  const handleRefresh = async () => {
    setRefreshing(true);
    await resetInfiniteQuery(queryClient, ['showtimes', 'main', showtimesFilters]);
    setSnapshotTime(DateTime.now().setZone('Europe/Amsterdam').toFormat("yyyy-MM-dd'T'HH:mm:ss"));
    setRefreshing(false);
  };

  const handleLoadMore = () => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  };

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
      selectedFilter={selectedFilter}
      onSelectFilter={setSelectedFilter}
      emptyText="No showtimes found"
    />
  );
}
