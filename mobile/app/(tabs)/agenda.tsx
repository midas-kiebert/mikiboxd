import { useState } from 'react';
import { DateTime } from 'luxon';
import { useQueryClient } from '@tanstack/react-query';
import { useFetchMyShowtimes } from 'shared/hooks/useFetchMyShowtimes';

import ShowtimesScreen from '@/components/showtimes/ShowtimesScreen';

const FILTERS = [
  { id: '1', label: 'All' },
  { id: '2', label: 'Going' },
  { id: '3', label: 'Interested' },
];

export default function AgendaScreen() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFilter, setSelectedFilter] = useState('1');
  const [refreshing, setRefreshing] = useState(false);
  const [snapshotTime, setSnapshotTime] = useState(() =>
    DateTime.now().setZone('Europe/Amsterdam').toFormat("yyyy-MM-dd'T'HH:mm:ss")
  );

  const queryClient = useQueryClient();

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
  });

  const showtimes = data?.pages.flat() ?? [];

  const handleRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['showtimes', 'me'] });
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
      filters={FILTERS}
      selectedFilter={selectedFilter}
      onSelectFilter={setSelectedFilter}
      emptyText="No showtimes in your agenda"
    />
  );
}
