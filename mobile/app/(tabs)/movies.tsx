import { useMemo, useState } from 'react';
import {
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFetchMovies, type MovieFilters } from 'shared/hooks/useFetchMovies';
import { useSessionCinemaSelections } from 'shared/hooks/useSessionCinemaSelections';
import { DateTime } from 'luxon';
import { useQueryClient } from '@tanstack/react-query';
import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import TopBar from '@/components/layout/TopBar';
import SearchBar from '@/components/inputs/SearchBar';
import FilterPills from '@/components/filters/FilterPills';
import CinemaFilterModal from '@/components/filters/CinemaFilterModal';
import DayFilterModal from '@/components/filters/DayFilterModal';
import { useThemeColors } from '@/hooks/use-theme-color';
import MovieCard from '@/components/movies/MovieCard';
import { resetInfiniteQuery } from '@/utils/reset-infinite-query';

const BASE_FILTERS = [
  { id: '1', label: 'All Movies' },
  { id: 'cinemas', label: 'Cinemas' },
  { id: 'days', label: 'Days' },
  { id: 'you-going', label: 'You Going' },
  { id: 'you-interested', label: 'You Interested' },
  { id: 'friends-going', label: 'Friends Going' },
  { id: 'friends-interested', label: 'Friends Interested' },
];

export default function MovieScreen() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFilter, setSelectedFilter] = useState('1');
  const [refreshing, setRefreshing] = useState(false);
  const [cinemaModalVisible, setCinemaModalVisible] = useState(false);
  const [dayModalVisible, setDayModalVisible] = useState(false);
  const [selectedDays, setSelectedDays] = useState<string[]>([]);
  const [snapshotTime, setSnapshotTime] = useState(() =>
    DateTime.now().setZone('Europe/Amsterdam').toFormat("yyyy-MM-dd'T'HH:mm:ss")
  );

  const { selections: sessionCinemaIds } = useSessionCinemaSelections();

  const colors = useThemeColors();
  const styles = createStyles(colors);

  const queryClient = useQueryClient();

  const movieFilters = useMemo<MovieFilters>(
    () => ({
      query: searchQuery,
      days: selectedDays.length > 0 ? selectedDays : undefined,
      selectedCinemaIds: sessionCinemaIds,
    }),
    [searchQuery, selectedDays, sessionCinemaIds]
  );

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
    filters: movieFilters,
  });

  const movies = moviesData?.pages.flat() || [];

  const filteredMovies = useMemo(() => {
    switch (selectedFilter) {
      case 'you-going':
        return movies.filter((movie) => movie.going === 'GOING');
      case 'you-interested':
        return movies.filter((movie) => movie.going === 'INTERESTED');
      case 'friends-going':
        return movies.filter((movie) => (movie.friends_going ?? []).length > 0);
      case 'friends-interested':
        return movies.filter((movie) => (movie.friends_interested ?? []).length > 0);
      default:
        return movies;
    }
  }, [movies, selectedFilter]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await resetInfiniteQuery(queryClient, ['movies', movieFilters]);
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

  const handleSelectFilter = (filterId: string) => {
    if (filterId === 'cinemas') {
      setCinemaModalVisible(true);
      return;
    }
    if (filterId === 'days') {
      setDayModalVisible(true);
      return;
    }
    setSelectedFilter(filterId);
  };

  const pillFilters = useMemo(() => {
    if (selectedDays.length === 0) return BASE_FILTERS;
    return BASE_FILTERS.map((filter) =>
      filter.id === 'days'
        ? { ...filter, label: `Days (${selectedDays.length})` }
        : filter
    );
  }, [selectedDays.length]);

  const activeFilterIds = useMemo(() => {
    const active: string[] = [];
    if (selectedDays.length > 0) {
      active.push('days');
    }
    if (sessionCinemaIds !== undefined) {
      active.push('cinemas');
    }
    return active;
  }, [selectedDays.length, sessionCinemaIds]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <TopBar />
      <SearchBar value={searchQuery} onChangeText={setSearchQuery} placeholder="Search movies" />
      <FilterPills
        filters={pillFilters}
        selectedId={selectedFilter}
        onSelect={handleSelectFilter}
        activeIds={activeFilterIds}
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

      {/* Movie Feed */}
      <FlatList
        data={filteredMovies}
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
