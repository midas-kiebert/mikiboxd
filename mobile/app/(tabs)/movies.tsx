/**
 * Expo Router screen/module for (tabs) / movies. It controls navigation and screen-level state for this route.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  StyleSheet,
  FlatList,
  View,
} from 'react-native';
import {
  pullToRefreshContentStyle,
  pullToRefreshScrollProps,
  ThemedRefreshControl,
} from '@/components/themed-refresh-control';
import TopSafeAreaView from '@/components/layout/TopSafeAreaView';
import { useSettledFocus } from '@/utils/use-settled-focus';
import { useRouter } from 'expo-router';
import { useFetchMovies, type MovieFilters } from 'shared/hooks/useFetchMovies';
import type { SearchField } from 'shared/client';
import type { MovieSummaryPublic } from 'shared';
import { useFetchSelectedCinemas } from 'shared/hooks/useFetchSelectedCinemas';
import useAuth from 'shared/hooks/useAuth';
import { DateTime } from 'luxon';
import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import ListLoadingLogo from '@/components/layout/ListLoadingLogo';
import { FeedItemEntrance } from '@/components/ui/FeedItemEntrance';
import LoadMoreFooter from '@/components/ui/LoadMoreFooter';
import TopBar from '@/components/layout/TopBar';
import SearchBar from '@/components/inputs/SearchBar';
import PresetsRow from '@/components/filters/PresetsRow';
import { FILTER_ROW_SETTLE_MS } from '@/components/filters/filter-change-animation';
import FiltersButton from '@/components/filters/FiltersButton';
import SearchFieldFallback from '@/components/inputs/SearchFieldFallback';
import { useFiltersModal } from '@/components/filters/FiltersModalProvider';
import ActiveFilterChips from '@/components/filters/ActiveFilterChips';
import { resolveDaySelectionsForApi } from '@/components/filters/day-filter-utils';
import { applyDisplayPreset, type DisplayPreset } from '@/components/filters/saved-presets';
import { getRuntimeBoundsFromSelections } from '@/components/filters/runtime-range-utils';
import {
  getSelectedStatusesFromShowtimeFilter,
  toSharedTabShowtimeFilter,
} from '@/components/filters/shared-tab-filters';
import { tabletCappedContentStyle } from '@/constants/tablet-layout';
import { useThemeColors } from '@/hooks/use-theme-color';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useDelayedTrue } from '@/hooks/useDelayedTrue';
import { LOADING_LOGO_DELAY_MS, LOADING_LOGO_COOLDOWN_MS } from '@/constants/loading-logo';
import { useSharedTabFilters } from '@/hooks/useSharedTabFilters';
import { useSingleFireNavigation } from '@/hooks/useSingleFireNavigation';
import MovieCard from '@/components/movies/MovieCard';
import {
  byIdKeyExtractor,
  MOVIES_FIRST_PAGE_LIMIT,
  useScrollTriggeredLoadMore,
} from '@/components/feeds/feed-paging';
import { useIsSignedIn } from '@/utils/auth-session';
import { buildSnapshotTime, useSnapshotRefresh } from '@/utils/reset-infinite-query';

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
  const { openFiltersModal } = useFiltersModal();
  const isFocused = useSettledFocus();
  // A preset can write `watchlistOnly`/`hideWatched` alone, which reach the
  // query a frame late (see useSharedTabFilters' rAF-deferred "applied"
  // values) — for that one frame `movieFilters` hasn't moved yet, so if the
  // *previous* filters also had zero results, isLoading/isFetching are still
  // false and "No movies found" flashes before the real load state catches
  // up. Held for the same settle window the filter row's own animation uses,
  // which comfortably outlasts that one frame. `feedHoldUntil` (not just a
  // boolean) so a second preset tapped during the first one's hold re-arms
  // the wait instead of inheriting the first one's deadline — see
  // (tabs)/index.tsx, which uses the same pattern.
  const [isFilterTransitionLoading, setIsFilterTransitionLoading] = useState(false);
  const [feedHoldUntil, setFeedHoldUntil] = useState(0);

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
    useFetchMovies({
      limit: 15,
      firstPageLimit: MOVIES_FIRST_PAGE_LIMIT,
      snapshotTime,
      filters: movieFilters,
      enabled: isFocused,
    });

  const movies = moviesData?.pages.flat() || [];

  useEffect(() => {
    if (!isFilterTransitionLoading) return;
    const wait = feedHoldUntil - Date.now();
    if (wait > 0) {
      const timer = setTimeout(() => setIsFilterTransitionLoading(false), wait);
      return () => clearTimeout(timer);
    }
    const frame = requestAnimationFrame(() => setIsFilterTransitionLoading(false));
    return () => cancelAnimationFrame(frame);
  }, [feedHoldUntil, isFilterTransitionLoading]);

  const { refreshing, handleRefresh } = useSnapshotRefresh({ setSnapshotTime, isFetching });

  // One identity for the life of the list: a new `renderItem` re-renders every
  // cell, which would undo `MovieCard`'s memo.
  const openMovie = useCallback((movie: { id: number }) => goToMovie(movie.id), [goToMovie]);
  const renderMovie = useCallback(
    ({ item, index }: { item: MovieSummaryPublic; index: number }) => (
      <FeedItemEntrance index={index}>
        <MovieCard movie={item} onPress={openMovie} />
      </FeedItemEntrance>
    ),
    [openMovie]
  );

  const loadMore = useScrollTriggeredLoadMore(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  });

  // Always mounted: the footer collapses instead of vanishing, so a loaded
  // page glides into place rather than snapping up a whole row.
  const renderFooter = () => <LoadMoreFooter loading={isFetchingNextPage} />;

  // Pull-to-refresh no longer clears the list: RefreshControl's own spinner
  // at the top already says a reload is happening, so the old cards just
  // stay up and get swapped for the fresh ones once they land — no separate
  // "reload" state needed, and nothing for the loading panel to do here. A
  // preset apply does still clear it: `isFilterTransitionLoading` covers the
  // frame where the query hasn't moved yet but the old results no longer
  // describe what's selected.
  const visibleMovies = isFilterTransitionLoading ? [] : movies;

  // `!refreshing`: RefreshControl's own spinner already covers a
  // pull-to-refresh, so the panel has nothing to do for one even on an
  // already-empty list. Both a genuine first load and a background refetch
  // go through the same delay+cooldown — a preset or filter combo that's
  // been used before (or just hits a nearby cache entry) very often resolves
  // faster than LOADING_LOGO_DELAY_MS even with nothing cached yet, so
  // showing `isLoading` immediately just moved the flash from "quick filter
  // taps" to "quick presets" instead of removing it.
  const isFetchEmptyLoading =
    (isLoading || isFetching) && !refreshing && visibleMovies.length === 0;
  const showFetchLoadingLogo = useDelayedTrue(
    isFetchEmptyLoading,
    LOADING_LOGO_DELAY_MS,
    LOADING_LOGO_COOLDOWN_MS
  );
  // Same show delay (a preset whose results are already cached resolves well
  // inside it, and forcing the panel up for the whole hold flashed it on
  // every single tap) but deliberately *no* cooldown, on a clock of its own:
  // the cooldown is there to absorb a raw fetch flag's flicker, and one left
  // ticking by a previous preset would otherwise outlast this hold and
  // swallow the panel for the next preset entirely.
  const showTransitionLoadingLogo = useDelayedTrue(
    isFilterTransitionLoading,
    LOADING_LOGO_DELAY_MS
  );
  // The hold still suppresses the empty-state copy for its whole length,
  // delay or not — "No movies found" must never describe filters that have
  // already been replaced.
  const isEmptyLoading = isFetchEmptyLoading || isFilterTransitionLoading;
  const showLoadingLogo = showFetchLoadingLogo || showTransitionLoadingLogo;

  const renderEmpty = () => {
    // The loading panel is a fixed overlay (below), not part of the list's
    // own content, so there's nothing to render here while it's up. And
    // never the "nothing found" copy while a refresh is in flight either —
    // the pull gesture's own spinner already covers that, and this would
    // otherwise flash up for an already-empty list mid-refresh even though
    // the loading panel is deliberately skipped for that case.
    if (isEmptyLoading || refreshing) return null;
    return (
      <ThemedView style={styles.centerContainer}>
        <ThemedText style={styles.emptyText}>No movies found</ThemedText>
        <SearchFieldFallback
          searchField={searchField}
          query={effectiveSearchQuery}
          onSearchByTitle={() => setSearchField('title')}
        />
      </ThemedView>
    );
  };

  const handleApplyPreset = (preset: DisplayPreset) => {
    setFeedHoldUntil(Date.now() + FILTER_ROW_SETTLE_MS);
    setIsFilterTransitionLoading(true);
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
        leftSlot={
          <FiltersButton onPress={() => openFiltersModal({ showGroupByMovie: false })} />
        }
      />
      <PresetsRow onApplyPreset={handleApplyPreset} />
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

      <View style={styles.listWrapper}>
        <FlatList
          data={visibleMovies}
          renderItem={renderMovie}
          keyExtractor={byIdKeyExtractor}
          contentContainerStyle={[styles.movieFeed, pullToRefreshContentStyle]}
          {...pullToRefreshScrollProps}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={renderEmpty}
          ListFooterComponent={renderFooter}
          onScrollBeginDrag={loadMore.onScrollBeginDrag}
          onEndReached={loadMore.onEndReached}
          onEndReachedThreshold={2}
          refreshControl={<ThemedRefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        />
        {/* An overlay, not the list's ListEmptyComponent: that content scrolls
            and shifts with RefreshControl's pull, which read as the logo
            drifting down the screen. Sitting outside the FlatList keeps it
            fixed in place and (via pointerEvents="none") never intercepts the
            pull-to-refresh gesture underneath it. */}
        {showLoadingLogo ? (
          <View style={styles.loadingOverlay} pointerEvents="none">
            <ListLoadingLogo />
          </View>
        ) : null}
      </View>
    </TopSafeAreaView>
  );
}

const createStyles = (colors: typeof import('@/constants/theme').Colors.light) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    listWrapper: { flex: 1 },
    loadingOverlay: { ...StyleSheet.absoluteFillObject },
    movieFeed: { ...tabletCappedContentStyle, padding: 16 },
    centerContainer: { paddingVertical: 40, alignItems: 'center' },
    emptyText: { fontSize: 16, color: colors.textSecondary },
  });
