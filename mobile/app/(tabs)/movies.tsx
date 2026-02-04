import { useState } from 'react';
import {
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFetchMovies } from 'shared/hooks/useFetchMovies';
import { DateTime } from 'luxon';
import { useQueryClient } from '@tanstack/react-query';
import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import TopBar from '@/components/layout/TopBar';
import SearchBar from '@/components/inputs/SearchBar';
import FilterPills from '@/components/filters/FilterPills';
import { useThemeColors } from '@/hooks/use-theme-color';
import MovieCard from '@/components/movies/MovieCard';

// Mock data for development
const MOCK_FILTERS = [
  { id: '1', label: 'All Movies' },
  { id: '2', label: 'Watchlist Only' },
  { id: '3', label: 'Tomorrow' },
  { id: '4', label: 'This Week' },
  { id: '5', label: 'Action' },
  { id: '6', label: 'Drama' },
  { id: '7', label: 'Comedy' },
];

export default function MovieScreen() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFilter, setSelectedFilter] = useState('1');
  const [refreshing, setRefreshing] = useState(false);
  const [snapshotTime, setSnapshotTime] = useState(() =>
    DateTime.now().setZone('Europe/Amsterdam').toFormat("yyyy-MM-dd'T'HH:mm:ss")
  );

  const colors = useThemeColors();
  const styles = createStyles(colors);

  const queryClient = useQueryClient();

  const {
    data: moviesData,
    isLoading,
    isFetchingNextPage,
    isFetching,
    hasNextPage,
    fetchNextPage
  } = useFetchMovies({
    limit: 20,
    snapshotTime,
    filters: {
      query: searchQuery,
      watchlistOnly: selectedFilter === '2',
    }
  });

  const movies = moviesData?.pages.flat() || [];

  const handleRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['movies'] });
    setSnapshotTime(DateTime.now().setZone('Europe/Amsterdam').toFormat("yyyy-MM-dd'T'HH:mm:ss"));
    setRefreshing(false);
  };

  const renderFooter = () => {
    if (!isFetchingNextPage) return null;
    return (
      <ThemedView style={styles.footerLoader}>
        <ActivityIndicator size="large" color={colors.tint} />
      </ThemedView>
    );
  };

  const renderEmpty = () => {
    if (isLoading || isFetching) {
      return (
        <ThemedView style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.tint} />
        </ThemedView>
      );
    }
    return (
      <ThemedView style={styles.centerContainer}>
        <ThemedText style={styles.emptyText}>No movies found</ThemedText>
      </ThemedView>
    );
  };

  const handleLoadMore = () => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <TopBar />
      <SearchBar value={searchQuery} onChangeText={setSearchQuery} placeholder="Search movies" />
      <FilterPills
        filters={MOCK_FILTERS}
        selectedId={selectedFilter}
        onSelect={setSelectedFilter}
      />

      {/* Movie Feed */}
      <FlatList
        data={movies}
        renderItem={({ item }) => (
          <MovieCard
            movie={item}
            onPress={(movie) => router.push(`/movie/${movie.id}`)}
          />
        )}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.movieFeed}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={renderEmpty}
        ListFooterComponent={renderFooter}
        onEndReached={handleLoadMore}
        onEndReachedThreshold={2}
        refreshing={isLoading}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
          />
        }
      />
    </SafeAreaView>
  );
}

const createStyles = (colors: typeof import('@/constants/theme').Colors.light) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    movieFeed: {
      padding: 16,
    },
    footerLoader: {
      paddingVertical: 20,
      alignItems: 'center',
    },
    centerContainer: {
      paddingVertical: 40,
      alignItems: 'center',
    },
    emptyText: {
      fontSize: 16,
      color: colors.textSecondary,
    },
  });
