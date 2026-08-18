/**
 * Expo Router screen/module for (tabs) / movies. It controls navigation and screen-level state for this route.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  StyleSheet,
  FlatList,
} from 'react-native';
import { ThemedRefreshControl } from '@/components/themed-refresh-control';
import TopSafeAreaView from '@/components/layout/TopSafeAreaView';
import { useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { useFetchMovies, type MovieFilters } from 'shared/hooks/useFetchMovies';
import type { SearchField } from 'shared/client';
import { useFetchSelectedCinemas } from 'shared/hooks/useFetchSelectedCinemas';
import useAuth from 'shared/hooks/useAuth';
import { DateTime } from 'luxon';
import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import { SkeletonRows } from '@/components/ui/SkeletonRows';
import LoadMoreFooter from '@/components/ui/LoadMoreFooter';
import TopBar from '@/components/layout/TopBar';
import SearchBar from '@/components/inputs/SearchBar';
import FiltersRow from '@/components/filters/FiltersRow';
import { useFiltersModal } from '@/components/filters/FiltersModalProvider';
import ActiveFilterChips from '@/components/filters/ActiveFilterChips';
import { resolveDaySelectionsForApi } from '@/components/filters/day-filter-utils';
import { applyDisplayPreset, type DisplayPreset } from '@/components/filters/saved-presets';
import { getRuntimeBoundsFromSelections } from '@/components/filters/runtime-range-utils';
import {
  getSelectedStatusesFromShowtimeFilter,
  toSharedTabShowtimeFilter,
} from '@/components/filters/shared-tab-filters';
import { useThemeColors } from '@/hooks/use-theme-color';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useSharedTabFilters } from '@/hooks/useSharedTabFilters';
import { useSingleFireNavigation } from '@/hooks/useSingleFireNavigation';
import MovieCard from '@/components/movies/MovieCard';
import { useIsSignedIn } from '@/utils/auth-session';
import { buildSnapshotTime, refreshInfiniteQueryWithFreshSnapshot } from '@/utils/reset-infinite-query';

// One request per pause in typing, not one per keystroke — see
// useDebouncedValue and (tabs)/index.tsx's identical guard.
const SEARCH_DEBOUNCE_MS = 280;

export default function MovieScreen() {
  const router = useRouter();
  const goToMovie = useSingleFireNavigation((movieId: number) => router.push(`/movie/${movieId}`));
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchField, setSearchField] = useState<SearchField>('title');
  const debouncedSearchQuery = useDebouncedValue(searchQuery, SEARCH_DEBOUNCE_MS);
  // Clearing the field drops the results immediately — waiting out the
  // debounce to remove what the user just deleted would feel broken.
  const effectiveSearchQuery = searchQuery.trim().length > 0 ? debouncedSearchQuery : '';
  const [refreshing, setRefreshing] = useState(false);
  const { openFiltersModal } = useFiltersModal();
  const isFocused = useIsFocused();

  const {
    selectedShowtimeFilter,
    setSelectedShowtimeFilter,
    watchlistOnly,
    appliedWatchlistOnly,
    setWatchlistOnly,
    hideWatched,
    appliedHideWatched,
    setHideWatched,
    groupByMovie,
    setGroupByMovie,
    sessionCinemaIds,
    setSessionCinemaIds,
    selectedDays,
    setSelectedDays,
    selectedTimeRanges,
    setSelectedTimeRanges,
    selectedRuntimeRanges,
    setSelectedRuntimeRanges,
    selectedListIds,
    setSelectedListIds,
    excludeListIds,
    setExcludeListIds,
    selectedLanguages,
    setSelectedLanguages,
    watchlistExclude,
    setWatchlistExclude,
    watchedOnly,
    setWatchedOnly,
  } = useSharedTabFilters();

  const { user } = useAuth();
  const isSignedIn = useIsSignedIn();
  const hasLetterboxdUsername = Boolean(user?.letterboxd_username?.trim());
  const effectiveWatchlistOnly = hasLetterboxdUsername ? watchlistOnly : false;
  const effectiveAppliedWatchlistOnly = hasLetterboxdUsername ? appliedWatchlistOnly : false;
  const effectiveHideWatched = hasLetterboxdUsername ? hideWatched : false;
  const effectiveAppliedHideWatched = hasLetterboxdUsername ? appliedHideWatched : false;
  const effectiveWatchlistExclude = hasLetterboxdUsername ? watchlistExclude : false;
  const effectiveWatchedOnly = hasLetterboxdUsername ? watchedOnly : false;

  const dayAnchorKey =
    DateTime.now().setZone('Europe/Amsterdam').startOf('day').toISODate() ?? '';
  const resolvedApiDays = useMemo(
    () =>
      resolveDaySelectionsForApi(selectedDays, {
        startDate: DateTime.fromISO(dayAnchorKey, { zone: "Europe/Amsterdam" }),
      }),
    [dayAnchorKey, selectedDays]
  );
  const runtimeBounds = useMemo(
    () => getRuntimeBoundsFromSelections(selectedRuntimeRanges),
    [selectedRuntimeRanges]
  );
  const [snapshotTime, setSnapshotTime] = useState(() => buildSnapshotTime());
  // No account, no saved cinemas to fall back to — a guest's picks are the
  // session selection itself (see hooks/useCinemaSelection).
  const { data: preferredCinemaIds } = useFetchSelectedCinemas({ enabled: isSignedIn });

  useEffect(() => {
    if (hasLetterboxdUsername || !watchlistOnly) return;
    setWatchlistOnly(false);
  }, [hasLetterboxdUsername, setWatchlistOnly, watchlistOnly]);

  useEffect(() => {
    if (hasLetterboxdUsername || !hideWatched) return;
    setHideWatched(false);
  }, [hasLetterboxdUsername, setHideWatched, hideWatched]);

  // A cinema-name search already narrows results to matching cinemas, so a
  // cinema selection on top of it would only ever narrow further — the pill
  // reads as "All cinemas" and the query drops the filter to match, while
  // sessionCinemaIds itself is left alone (see CinemaFilterChip's `disabled`).
  const isSearchingByCinema = searchField === "cinema" && effectiveSearchQuery.trim().length > 0;

  const movieFilters = useMemo<MovieFilters>(
    () => ({
      query: effectiveSearchQuery,
      searchField,
      watchlistOnly: effectiveAppliedWatchlistOnly ? true : undefined,
      hideWatched: effectiveAppliedHideWatched ? true : undefined,
      days: resolvedApiDays,
      timeRanges: selectedTimeRanges.length > 0 ? selectedTimeRanges : undefined,
      runtimeMin: runtimeBounds.runtimeMin,
      runtimeMax: runtimeBounds.runtimeMax,
      selectedCinemaIds: isSearchingByCinema ? undefined : sessionCinemaIds,
      selectedStatuses: getSelectedStatusesFromShowtimeFilter(selectedShowtimeFilter),
      watchlistExclude: effectiveWatchlistExclude ? true : undefined,
      watchedOnly: effectiveWatchedOnly ? true : undefined,
      selectedListIds: selectedListIds.length > 0 ? selectedListIds : undefined,
      excludeListIds: excludeListIds.length > 0 ? excludeListIds : undefined,
      selectedLanguages: selectedLanguages.length > 0 ? selectedLanguages : undefined,
    }),
    [
      effectiveSearchQuery,
      searchField,
      effectiveAppliedWatchlistOnly,
      effectiveAppliedHideWatched,
      effectiveWatchlistExclude,
      effectiveWatchedOnly,
      resolvedApiDays,
      selectedTimeRanges,
      selectedListIds,
      excludeListIds,
      runtimeBounds.runtimeMin,
      runtimeBounds.runtimeMax,
      sessionCinemaIds,
      isSearchingByCinema,
      selectedShowtimeFilter,
      selectedLanguages,
    ]
  );

  const { data: moviesData, isLoading, isFetchingNextPage, isFetching, hasNextPage, fetchNextPage } =
    useFetchMovies({ limit: 15, snapshotTime, filters: movieFilters, enabled: isFocused });

  const movies = moviesData?.pages.flat() || [];

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshInfiniteQueryWithFreshSnapshot({ setSnapshotTime });
    } finally {
      setRefreshing(false);
    }
  };

  const handleLoadMore = () => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  };

  // Always mounted: the footer collapses instead of vanishing, so a loaded
  // page glides into place rather than snapping up a whole row.
  const renderFooter = () => <LoadMoreFooter loading={isFetchingNextPage} />;

  const renderEmpty = () => {
    if (isLoading || isFetching || refreshing) {
      return <SkeletonRows height={150} />;
    }
    return (
      <ThemedView style={styles.centerContainer}>
        <ThemedText style={styles.emptyText}>No movies found</ThemedText>
      </ThemedView>
    );
  };

  // Clear the list while refreshing so pull-to-refresh visibly reloads, even
  // when the refetched data is unchanged.
  const visibleMovies = refreshing ? [] : movies;

  const handleApplyPreset = (preset: DisplayPreset) => {
    applyDisplayPreset(preset, {
      hasLetterboxdUsername,
      setSelectedShowtimeFilter,
      setWatchlistOnly,
      setWatchlistExclude,
      setHideWatched,
      setWatchedOnly,
      setSelectedDays,
      setSelectedTimeRanges,
      setSelectedRuntimeRanges,
      setSessionCinemaIds,
      setGroupByMovie,
      setSelectedLanguages,
      selectedListIds,
      excludeListIds,
      setSelectedListIds,
      setExcludeListIds,
    });
  };


  return (
    <TopSafeAreaView style={styles.container}>
      <TopBar />
      <SearchBar
        value={searchQuery}
        onChangeText={setSearchQuery}
        searchField={searchField}
        onChangeSearchField={setSearchField}
        clearOnAndroidBack
      />
      <FiltersRow
        onOpenModal={() => openFiltersModal({ showGroupByMovie: false })}
        onApplyPreset={handleApplyPreset}
      />
      <ActiveFilterChips
        groupByMovie={groupByMovie}
        setGroupByMovie={setGroupByMovie}
        watchlistOnly={effectiveWatchlistOnly}
        setWatchlistOnly={setWatchlistOnly}
        watchlistExclude={effectiveWatchlistExclude}
        setWatchlistExclude={setWatchlistExclude}
        hideWatched={effectiveHideWatched}
        setHideWatched={setHideWatched}
        watchedOnly={effectiveWatchedOnly}
        setWatchedOnly={setWatchedOnly}
        canUseWatchlistFilter={hasLetterboxdUsername}
        selectedShowtimeFilter={selectedShowtimeFilter}
        setSelectedShowtimeFilter={setSelectedShowtimeFilter}
        showStatusFilter
        selectedDays={selectedDays}
        setSelectedDays={setSelectedDays}
        selectedTimeRanges={selectedTimeRanges}
        setSelectedTimeRanges={setSelectedTimeRanges}
        selectedRuntimeRanges={selectedRuntimeRanges}
        setSelectedRuntimeRanges={setSelectedRuntimeRanges}
        selectedListIds={selectedListIds}
        setSelectedListIds={setSelectedListIds}
        excludeListIds={excludeListIds}
        setExcludeListIds={setExcludeListIds}
        selectedLanguages={selectedLanguages}
        setSelectedLanguages={setSelectedLanguages}
        onOpenFilters={() => openFiltersModal({ showGroupByMovie: false })}
        cinemaFilterDisabled={isSearchingByCinema}
        onClearAll={() => {
          setSelectedShowtimeFilter(toSharedTabShowtimeFilter('all'));
          setWatchlistOnly(false);
          setWatchlistExclude(false);
          setHideWatched(false);
          setWatchedOnly(false);
          setSelectedDays([]);
          setSelectedTimeRanges([]);
          setSelectedRuntimeRanges([]);
          setSelectedListIds([]);
          setExcludeListIds([]);
          setSelectedLanguages([]);
          if (preferredCinemaIds) setSessionCinemaIds(preferredCinemaIds);
        }}
      />

      <FlatList
        data={visibleMovies}
        renderItem={({ item }) => (
          <MovieCard movie={item} onPress={(movie) => goToMovie(movie.id)} />
        )}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.movieFeed}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={renderEmpty}
        ListFooterComponent={renderFooter}
        onEndReached={handleLoadMore}
        onEndReachedThreshold={2}
        refreshControl={<ThemedRefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      />
    </TopSafeAreaView>
  );
}

const createStyles = (colors: typeof import('@/constants/theme').Colors.light) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    movieFeed: { padding: 16 },
    centerContainer: { paddingVertical: 40, alignItems: 'center' },
    emptyText: { fontSize: 16, color: colors.textSecondary },
  });
