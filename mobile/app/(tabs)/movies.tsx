/**
 * Expo Router screen/module for (tabs) / movies. It controls navigation and screen-level state for this route.
 */
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
import { useFetchSelectedCinemas } from 'shared/hooks/useFetchSelectedCinemas';
import { useSessionCinemaSelections } from 'shared/hooks/useSessionCinemaSelections';
import { useSessionDaySelections } from 'shared/hooks/useSessionDaySelections';
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
import { isCinemaSelectionDifferentFromPreferred } from '@/utils/cinema-selection';
import { resetInfiniteQuery } from '@/utils/reset-infinite-query';

// Filter pill definitions rendered in the top filter row.
const BASE_FILTERS = [
  { id: 'watchlist-only', label: 'Watchlist Only' },
  { id: 'cinemas', label: 'Cinemas' },
  { id: 'days', label: 'Days' },
];

const EMPTY_DAYS: string[] = [];

export default function MovieScreen() {
  // Read flow: local state and data hooks first, then handlers, then the JSX screen.
  const router = useRouter();
  // Current text typed into the search input.
  const [searchQuery, setSearchQuery] = useState('');
  // Whether the list should be limited to movies in the user's watchlist.
  const [watchlistOnly, setWatchlistOnly] = useState(false);
  // Controls pull-to-refresh spinner visibility.
  const [refreshing, setRefreshing] = useState(false);
  // Controls visibility of the cinema-filter modal.
  const [cinemaModalVisible, setCinemaModalVisible] = useState(false);
  // Controls visibility of the day-filter modal.
  const [dayModalVisible, setDayModalVisible] = useState(false);
  const { selections: sessionDays, setSelections: setSessionDays } = useSessionDaySelections();
  const selectedDays = sessionDays ?? EMPTY_DAYS;
  // Snapshot time is part of the query key so pull-to-refresh can force a full refresh.
  const [snapshotTime, setSnapshotTime] = useState(() =>
    DateTime.now().setZone('Europe/Amsterdam').toFormat("yyyy-MM-dd'T'HH:mm:ss")
  );

  const { selections: sessionCinemaIds } = useSessionCinemaSelections();
  const { data: preferredCinemaIds } = useFetchSelectedCinemas();

  // Read the active theme color tokens used by this screen/component.
  const colors = useThemeColors();
  const styles = createStyles(colors);

  // React Query client used for cache updates and invalidation.
  const queryClient = useQueryClient();

  // Build the filter payload once per relevant state change to avoid unnecessary refetches.
  const movieFilters = useMemo<MovieFilters>(
    () => ({
      query: searchQuery,
      watchlistOnly: watchlistOnly ? true : undefined,
      days: selectedDays.length > 0 ? selectedDays : undefined,
      selectedCinemaIds: sessionCinemaIds,
    }),
    [searchQuery, watchlistOnly, selectedDays, sessionCinemaIds]
  );

  // Data hooks keep this module synced with backend data and shared cache state.
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

  // Flatten paginated query results into one array for list rendering.
  const movies = moviesData?.pages.flat() || [];

  // Refresh the current dataset and reset any stale pagination state.
  const handleRefresh = async () => {
    setRefreshing(true);
    // Reset cached pages for the current filters, then bump snapshot to request fresh data.
    await resetInfiniteQuery(queryClient, ['movies', movieFilters]);
    setSnapshotTime(DateTime.now().setZone('Europe/Amsterdam').toFormat("yyyy-MM-dd'T'HH:mm:ss"));
    setRefreshing(false);
  };

  // Render infinite-scroll loading feedback at the bottom of the list.
  const renderFooter = () => {
    if (!isFetchingNextPage) return null;
    return (
      <ThemedView style={styles.footerLoader}>
        <ActivityIndicator size="large" color={colors.tint} />
      </ThemedView>
    );
  };

  // Render the empty/loading state when list data is unavailable.
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

  // Request the next page when the list nears the end.
  const handleLoadMore = () => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  };

  // Handle filter pill presses and update active filter state.
  const handleSelectFilter = (filterId: string) => {
    if (filterId === 'watchlist-only') {
      setWatchlistOnly((prev) => !prev);
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
  };

  // Only decorate the day pill label when the filter is actually active.
  const pillFilters = useMemo(() => {
    if (selectedDays.length === 0) return BASE_FILTERS;
    return BASE_FILTERS.map((filter) =>
      filter.id === 'days'
        ? { ...filter, label: `Days (${selectedDays.length})` }
        : filter
    );
  }, [selectedDays.length]);

  // Cinema pill should only be active when current session differs from preferred cinemas.
  const isCinemaFilterActive = useMemo(
    () =>
      isCinemaSelectionDifferentFromPreferred({
        sessionCinemaIds,
        preferredCinemaIds,
      }),
    [sessionCinemaIds, preferredCinemaIds]
  );

  // These ids drive highlighted filter pills in the UI.
  const activeFilterIds = useMemo(() => {
    const active: string[] = [];
    if (watchlistOnly) {
      active.push('watchlist-only');
    }
    if (selectedDays.length > 0) {
      active.push('days');
    }
    if (isCinemaFilterActive) {
      active.push('cinemas');
    }
    return active;
  }, [watchlistOnly, selectedDays.length, isCinemaFilterActive]);

  // Render/output using the state and derived values prepared above.
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <TopBar />
      <SearchBar value={searchQuery} onChangeText={setSearchQuery} placeholder="Search movies" />
      <FilterPills
        filters={pillFilters}
        selectedId=""
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
        onChange={setSessionDays}
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
