/**
 * Expo Router screen/module for (tabs) / index. It controls navigation and screen-level state for this route.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, FlatList, StyleSheet, View } from 'react-native';
import {
  pullToRefreshContentStyle,
  pullToRefreshScrollProps,
  ThemedRefreshControl,
} from '@/components/themed-refresh-control';
import { DateTime } from 'luxon';
import { useNavigation } from "expo-router/react-navigation";
import TabScreenSkeleton from '@/components/layout/TabScreenSkeleton';
import { tabContentHoldMs } from '@/components/tab-bar';
import { useDeferredMount } from '@/utils/use-deferred-mount';
import { useSettledFocus } from '@/utils/use-settled-focus';
import { useRouter } from 'expo-router';
import { useFetchMainPageShowtimes } from 'shared/hooks/useFetchMainPageShowtimes';
import { useFetchMovies, type MovieFilters } from 'shared/hooks/useFetchMovies';
import type { SearchField } from 'shared/client';
import type { MovieSummaryPublic, ShowtimePublic } from 'shared';
import { useFetchSelectedCinemas } from 'shared/hooks/useFetchSelectedCinemas';
import useAuth from 'shared/hooks/useAuth';
import TopSafeAreaView from '@/components/layout/TopSafeAreaView';

import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import TopBar from '@/components/layout/TopBar';
import SearchBar from '@/components/inputs/SearchBar';
import PresetsRow from '@/components/filters/PresetsRow';
import { FILTER_ROW_SETTLE_MS } from '@/components/filters/filter-change-animation';
import FiltersButton from '@/components/filters/FiltersButton';
import SearchFieldFallback from '@/components/inputs/SearchFieldFallback';
import { useFiltersModal } from '@/components/filters/FiltersModalProvider';
import ActiveFilterChips from '@/components/filters/ActiveFilterChips';
import FeatureTipsHost from '@/components/tips/FeatureTipsHost';
import CinevilleCardButton from '@/components/cineville/CinevilleCardButton';
import IntroFiltersSpotlight from '@/components/intro/IntroFiltersSpotlight';
import { ShowtimesListContent } from '@/components/showtimes/ShowtimesScreen';
import LoadMoreFooter from '@/components/ui/LoadMoreFooter';
import ListLoadingLogo from '@/components/layout/ListLoadingLogo';
import { useDelayedTrue } from '@/hooks/useDelayedTrue';
import { LOADING_LOGO_DELAY_MS, LOADING_LOGO_COOLDOWN_MS } from '@/constants/loading-logo';
import { FeedItemEntrance } from '@/components/ui/FeedItemEntrance';
import MovieCard from '@/components/movies/MovieCard';
import {
  byIdKeyExtractor,
  MOVIES_FIRST_PAGE_LIMIT,
  SHOWTIMES_FIRST_PAGE_LIMIT,
  useScrollTriggeredLoadMore,
} from '@/components/feeds/feed-paging';
import { resolveDaySelectionsForApi } from '@/components/filters/day-filter-utils';
import { getRuntimeBoundsFromSelections } from '@/components/filters/runtime-range-utils';
import { applyDisplayPreset, type DisplayPreset } from '@/components/filters/saved-presets';
import {
  getSelectedStatusesFromShowtimeFilter,
} from '@/components/filters/shared-tab-filters';
import { tabletCappedContentStyle } from '@/constants/tablet-layout';
import { useThemeColors } from '@/hooks/use-theme-color';
import { useIsSignedIn } from '@/utils/auth-session';
import { useIsAnyBlockingOverlayOpen } from '@/utils/blocking-overlays';
import { useIntroPhase } from '@/utils/intro';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useSharedTabFilters } from '@/hooks/useSharedTabFilters';
import { useSingleFireNavigation } from '@/hooks/useSingleFireNavigation';
import { buildSnapshotTime, useSnapshotRefresh } from '@/utils/reset-infinite-query';
import { useRegisterTabReselect } from '@/components/tab-bar';

// One request per pause in typing, not one per keystroke — five requests for
// "alkmaar" racing each other otherwise, and whichever lands last (not
// necessarily the one for the finished word) is what the list is left
// showing. See useDebouncedValue.
/**
 * When the other tabs are built, and how far apart.
 *
 * A tab is mounted the first time you press it, in the same commit that starts
 * the slide — so the first press of each tab spends the whole animation
 * building a screen, and no animation outruns that: the mount is UI-thread
 * work, which is the one thing a native-driven tween cannot ignore.
 *
 * So they are built here instead, one at a time, once this screen has had a
 * while to settle. It costs the same work; it just spends it in dead time
 * rather than in front of the user. Pressing a tab before its turn comes round
 * simply mounts it the old way.
 */
const TAB_PRELOAD_START_MS = 2500;
const TAB_PRELOAD_GAP_MS = 600;
/** Every tab in the bar except this one. `movies` has no button. */
const PRELOADED_TABS = ['activity', 'friends', 'settings'] as const;

/** Only the parts of the tab navigator's state the preload guard below reads. */
type TabNavigatorState = {
  index: number;
  routes: { key: string; name: string }[];
  /** TabRouter's visit log: one record per tab that has been focused. */
  history?: { key?: string }[];
};

/**
 * Whether the user has already been to this tab, so preloading it would be
 * both pointless and harmful — see the preload effect.
 *
 * Focused *now* counts as visited, and so does anything in the navigator's
 * history, which is where TabRouter records every tab that has been focused.
 */
const hasVisitedTab = (state: TabNavigatorState | undefined, name: string): boolean => {
  if (!state) return false;
  const route = state.routes.find((candidate) => candidate.name === name);
  if (!route) return false;
  if (state.routes[state.index]?.key === route.key) return true;
  return Boolean(state.history?.some((record) => record.key === route.key));
};

/**
 * Hoisted so the feed is handed the same object every render: it reaches
 * `ShowtimeCard` through the list's `renderItem`, and a new object there
 * re-renders every visible card. See `ShowtimeCard`'s memo.
 */
const SHOWTIME_MODAL_OPTIONS = { inheritFilters: true } as const;

const SEARCH_DEBOUNCE_MS = 280;

/**
 * How tall the stand-in for an empty/refreshing movies grid is kept — see
 * `renderMoviesEmpty`. Roughly a screenful, so the scroll content never
 * actually collapses during a refresh.
 */
const EMPTY_PLACEHOLDER_MIN_HEIGHT = Dimensions.get('window').height;

function MainShowtimesScreen() {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const router = useRouter();
  const goToMovieFromCard = useSingleFireNavigation((movieId: number) =>
    router.push({
      pathname: '/movie/[id]',
      params: { id: String(movieId), inheritFilters: '1' },
    })
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [searchField, setSearchField] = useState<SearchField>('title');
  const debouncedSearchQuery = useDebouncedValue(searchQuery, SEARCH_DEBOUNCE_MS);
  // Clearing the field drops the results immediately — waiting out the
  // debounce to remove what the user just deleted would feel broken.
  const effectiveSearchQuery = searchQuery.trim().length > 0 ? debouncedSearchQuery : '';
  const [isFilterTransitionLoading, setIsFilterTransitionLoading] = useState(false);
  /**
   * The earliest the feed may fill itself back in. Only a preset apply sets it:
   * that is the one filter change with a whole choreography playing above the
   * feed, and rebuilding the list underneath is enough UI-thread work to stall
   * it half-way through. Everything else clears on the next frame as before.
   *
   * State rather than a ref so that a second preset tapped during the first
   * one's hold re-arms the wait instead of inheriting the first one's deadline.
   */
  const [feedHoldUntil, setFeedHoldUntil] = useState(0);
  const { openFiltersModal } = useFiltersModal();
  const [snapshotTime, setSnapshotTime] = useState(() => buildSnapshotTime());
  const isFocused = useSettledFocus();
  // Typed by hand: `preload` belongs to the tab navigator this screen sits in,
  // and the generic `useNavigation()` result cannot know which navigator that
  // is without the app declaring its whole route map.
  const tabNavigation = useNavigation<{
    preload: (name: string) => void;
    // Read, never subscribed to: `useNavigationState` would re-render this
    // screen inside every tab switch, which is the one thing the tab work has
    // been spent avoiding.
    getState: () => TabNavigatorState | undefined;
  }>();

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    PRELOADED_TABS.forEach((name, index) => {
      timers.push(
        setTimeout(() => {
          // Never preload a tab the user has already reached. A preload is only
          // ever meant to build a screen nobody has opened yet, and preloading
          // one that is already open is not the no-op it looks like: the
          // navigator keeps the route in `preloadedRouteKeys` from then on, and
          // nothing takes it out again. That list is what decides whether a
          // blurred screen may be frozen and detached
          // (`shouldFreeze: activityState === STATE_INACTIVE && !isPreloaded`
          // in BottomTabView) — so a tab preloaded while it was in front stops
          // being detachable for the rest of the session, and can be left
          // painted over the tab you actually switched to.
          //
          // These timers land 2.5-3.7s after launch, which is comfortably
          // inside the time it takes someone to open the app and press a tab.
          if (hasVisitedTab(tabNavigation.getState(), name)) return;
          tabNavigation.preload(name);
        }, TAB_PRELOAD_START_MS + index * TAB_PRELOAD_GAP_MS)
      );
    });
    return () => timers.forEach(clearTimeout);
  }, [tabNavigation]);
  // The intro's last step highlights this screen's Filters button in place.
  const filtersButtonRef = useRef<View>(null);
  // Scroll targets for the tab-bar reselect action (tapping Showtimes while
  // already on it) — whichever of the two feeds is currently rendered below.
  const moviesListRef = useRef<FlatList<MovieSummaryPublic>>(null);
  const showtimesListRef = useRef<FlatList<ShowtimePublic>>(null);
  const introPhase = useIntroPhase();
  const isAnyBlockingOverlayOpen = useIsAnyBlockingOverlayOpen();

  const {
    selectedShowtimeFilter,
    appliedShowtimeFilter,
    setSelectedShowtimeFilter,
    watchlistOnly,
    appliedWatchlistOnly,
    setWatchlistOnly,
    hideWatched,
    appliedHideWatched,
    setHideWatched,
    groupByMovie,
    appliedGroupByMovie,
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
    isHydrated,
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

  // "Clear all" restores the account's saved cinemas. A guest has none to
  // restore to — the session selection *is* what they saved — so their cinema
  // choice is deliberately left alone by it.
  const { data: preferredCinemaIds } = useFetchSelectedCinemas({ enabled: isSignedIn });

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

  // ─── Showtimes query ────────────────────────────────────────────────────────
  const showtimesFilters = useMemo(() => ({
    query: effectiveSearchQuery || undefined,
    searchField,
    selectedCinemaIds: isSearchingByCinema ? undefined : sessionCinemaIds,
    days: resolvedApiDays,
    timeRanges: selectedTimeRanges.length > 0 ? selectedTimeRanges : undefined,
    runtimeMin: runtimeBounds.runtimeMin,
    runtimeMax: runtimeBounds.runtimeMax,
    selectedStatuses: getSelectedStatusesFromShowtimeFilter(appliedShowtimeFilter),
    watchlistOnly: effectiveAppliedWatchlistOnly ? true : undefined,
    watchlistExclude: effectiveWatchlistExclude ? true : undefined,
    hideWatched: effectiveAppliedHideWatched ? true : undefined,
    watchedOnly: effectiveWatchedOnly ? true : undefined,
    selectedListIds: selectedListIds.length > 0 ? selectedListIds : undefined,
    excludeListIds: excludeListIds.length > 0 ? excludeListIds : undefined,
    selectedLanguages: selectedLanguages.length > 0 ? selectedLanguages : undefined,
  }), [
    effectiveSearchQuery, searchField, appliedShowtimeFilter, resolvedApiDays, selectedTimeRanges,
    runtimeBounds.runtimeMin, runtimeBounds.runtimeMax, sessionCinemaIds, isSearchingByCinema,
    effectiveAppliedWatchlistOnly, effectiveAppliedHideWatched, selectedListIds, excludeListIds,
    effectiveWatchlistExclude, effectiveWatchedOnly, selectedLanguages,
  ]);

  const activeShowtimesQuery = useFetchMainPageShowtimes({
    limit: 20,
    firstPageLimit: SHOWTIMES_FIRST_PAGE_LIMIT,
    snapshotTime,
    filters: showtimesFilters,
    enabled: isFocused && !appliedGroupByMovie && isHydrated,
  });

  // ─── Movies query (Group by Movie mode) ─────────────────────────────────────
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
      selectedStatuses: getSelectedStatusesFromShowtimeFilter(appliedShowtimeFilter),
      watchlistExclude: effectiveWatchlistExclude ? true : undefined,
      watchedOnly: effectiveWatchedOnly ? true : undefined,
      selectedListIds: selectedListIds.length > 0 ? selectedListIds : undefined,
      excludeListIds: excludeListIds.length > 0 ? excludeListIds : undefined,
      selectedLanguages: selectedLanguages.length > 0 ? selectedLanguages : undefined,
    }),
    [
      effectiveSearchQuery, searchField, effectiveAppliedWatchlistOnly, effectiveAppliedHideWatched, resolvedApiDays, selectedTimeRanges,
      runtimeBounds.runtimeMin, runtimeBounds.runtimeMax, sessionCinemaIds, isSearchingByCinema, appliedShowtimeFilter,
      selectedListIds, excludeListIds, effectiveWatchlistExclude, effectiveWatchedOnly, selectedLanguages,
    ]
  );
  const moviesQuery = useFetchMovies({
    limit: 20,
    firstPageLimit: MOVIES_FIRST_PAGE_LIMIT,
    snapshotTime,
    filters: movieFilters,
    enabled: isFocused && appliedGroupByMovie && isHydrated,
  });

  // ─── Active query ────────────────────────────────────────────────────────────
  const {
    data: showtimesData,
    isLoading: showtimesLoading,
    isFetchingNextPage: showtimesFetchingNextPage,
    isFetching: showtimesFetching,
    hasNextPage: showtimesHasNextPage,
    fetchNextPage: showtimesFetchNextPage,
  } = activeShowtimesQuery;

  const {
    data: moviesData,
    isLoading: moviesLoading,
    isFetchingNextPage: moviesFetchingNextPage,
    isFetching: moviesFetching,
    hasNextPage: moviesHasNextPage,
    fetchNextPage: moviesFetchNextPage,
  } = moviesQuery;

  // A focus-gated query that has not been switched on yet is neither loading nor
  // empty as far as react-query is concerned: no data, no fetch in flight. It is
  // loading — the fetch is owed — and saying otherwise renders the empty state
  // for the beat between the tab appearing and `useSettledFocus` letting the
  // query go, with the loading panel arriving after it. `data === undefined`
  // rather than an empty list, because a query that fetched and came back with
  // nothing really is empty and must go on saying so from the background.
  // `!isHydrated` gets the same treatment: the feed is held off it too (see
  // `useSharedTabFilters`), and that wait is exactly as "loading" as the focus
  // one is.
  const isAwaitingShowtimes = (!isFocused || !isHydrated) && showtimesData === undefined;
  const isAwaitingMovies = (!isFocused || !isHydrated) && moviesData === undefined;

  // One identity for the life of the list: a new `renderItem` re-renders every
  // cell, which would undo `MovieCard`'s memo.
  const openMovie = useCallback(
    (movie: { id: number }) => goToMovieFromCard(movie.id),
    [goToMovieFromCard]
  );
  const renderMovie = useCallback(
    ({ item, index }: { item: MovieSummaryPublic; index: number }) => (
      <FeedItemEntrance index={index}>
        <MovieCard movie={item} onPress={openMovie} />
      </FeedItemEntrance>
    ),
    [openMovie]
  );

  const loadMoreMovies = useScrollTriggeredLoadMore(() => {
    // `refreshing` (declared below): a refresh moves the query to a snapshot
    // key with nothing cached, so for a beat the list is genuinely empty,
    // which `onEndReached` reads as "the end" — see the matching guard in
    // `ShowtimesScreen.tsx` for why that must not start a real page fetch.
    if (refreshing || !moviesHasNextPage || moviesFetchingNextPage) return false;
    return moviesFetchNextPage();
  });

  const isAppliedFilterTransitionPending =
    selectedShowtimeFilter !== appliedShowtimeFilter ||
    effectiveWatchlistOnly !== effectiveAppliedWatchlistOnly ||
    effectiveHideWatched !== effectiveAppliedHideWatched ||
    groupByMovie !== appliedGroupByMovie;

  const showtimes = useMemo(() => showtimesData?.pages.flat() ?? [], [showtimesData]);
  const movies = useMemo(() => moviesData?.pages.flat() ?? [], [moviesData]);
  const visibleShowtimes = isFilterTransitionLoading ? [] : showtimes;

  useEffect(() => {
    if (!isFilterTransitionLoading) return;
    if (isAppliedFilterTransitionPending) return;
    // A timer rather than a frame when the filter row is still playing. Being
    // late here is harmless — the feed stays empty a moment longer — which is
    // the only kind of thing a JS timer may be trusted with while an apply has
    // the thread busy.
    const wait = feedHoldUntil - Date.now();
    if (wait > 0) {
      const timer = setTimeout(() => setIsFilterTransitionLoading(false), wait);
      return () => clearTimeout(timer);
    }
    const frame = requestAnimationFrame(() => setIsFilterTransitionLoading(false));
    return () => cancelAnimationFrame(frame);
  }, [feedHoldUntil, isAppliedFilterTransitionPending, isFilterTransitionLoading]);

  // One snapshot drives both the showtimes and movies queries, so which mode
  // is on screen no longer changes what a refresh has to do — and the refresh
  // is not over until whichever of them is on screen has its rows back.
  const { refreshing, handleRefresh } = useSnapshotRefresh({
    setSnapshotTime,
    isFetching: showtimesFetching || moviesFetching,
  });

  // A refresh replaces the movies grid with a fresh first page — exactly the
  // "just mounted" situation `useScrollTriggeredLoadMore` exists to protect.
  // Without re-arming it here, the debounce stays permanently spent after the
  // very first drag this list ever saw, so the fresh page's `onEndReached`
  // goes straight through to a real `fetchNextPage()`, flashing the footer
  // spinner on for a beat. (`ShowtimesListContent` does the equivalent for the
  // showtimes-mode feed internally.)
  const wasRefreshingRef = useRef(refreshing);
  useEffect(() => {
    if (refreshing && !wasRefreshingRef.current) {
      loadMoreMovies.reset();
    }
    wasRefreshingRef.current = refreshing;
  }, [refreshing, loadMoreMovies.reset]);

  // A refresh triggered without the user's finger on the glass — this one —
  // occasionally leaves iOS's RefreshControl's own scroll-position compensation
  // stuck: it makes room for the spinner up front but doesn't always give it
  // back once `refreshing` drops, leaving the list a few points short of 0.
  // The pull-to-refresh gesture itself isn't affected (there the offset is
  // already wherever the finger left it), so this only re-snaps after a
  // reselect-triggered reload. Animated, and fired the moment `refreshing`
  // drops rather than after a wait: in the normal case the list is already at
  // 0 from the initial scroll in `handleTabReselect`, so this glides nowhere
  // and is invisible; only the rare stuck case actually moves, and doing that
  // smoothly is far less jarring than the instant jump this replaced.
  const pendingScrollResetRef = useRef(false);
  useEffect(() => {
    if (!pendingScrollResetRef.current || refreshing) return;
    pendingScrollResetRef.current = false;
    (appliedGroupByMovie ? moviesListRef : showtimesListRef).current?.scrollToOffset({
      offset: 0,
      animated: true,
    });
  }, [refreshing, appliedGroupByMovie]);

  // Tapping the Showtimes tab again while already on it: scroll whichever
  // feed is on screen back to the top and reload it, the same way a
  // pull-to-refresh does (no extra loading screen — just fresh rows).
  const handleTabReselect = useCallback(() => {
    (appliedGroupByMovie ? moviesListRef : showtimesListRef).current?.scrollToOffset({
      offset: 0,
      animated: true,
    });
    pendingScrollResetRef.current = true;
    handleRefresh();
  }, [appliedGroupByMovie, handleRefresh]);
  useRegisterTabReselect('index', handleTabReselect);

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
      setGroupByMovie,
      setSelectedLanguages,
      setSessionCinemaIds,
      selectedListIds,
      excludeListIds,
      setSelectedListIds,
      setExcludeListIds,
    });
  };

  const handleOpenFiltersModal = () =>
    openFiltersModal({ showGroupByMovie: true, showPresets: true });

  // The last intro step waits for this screen to actually have something on it:
  // highlighting a filter button above an empty list would explain nothing. It
  // also waits for a clear screen — `isFocused` covers a pushed page, and the
  // overlay register covers the sheets that open over this one, which are
  // windows rather than routes.
  const hasLoadedFeed = appliedGroupByMovie
    ? !moviesLoading && movies.length > 0
    : !showtimesLoading && !isFilterTransitionLoading && showtimes.length > 0;
  const isShowingIntroFiltersSpotlight =
    introPhase === 'filters-spotlight' &&
    isFocused &&
    !isAnyBlockingOverlayOpen &&
    hasLoadedFeed;

  const activeChipsProps = {
    groupByMovie,
    setGroupByMovie: (v: boolean) => { setIsFilterTransitionLoading(true); setGroupByMovie(v); },
    watchlistOnly: effectiveWatchlistOnly,
    setWatchlistOnly: (v: boolean) => { setIsFilterTransitionLoading(true); setWatchlistOnly(v); },
    watchlistExclude: effectiveWatchlistExclude,
    setWatchlistExclude: (v: boolean) => { setIsFilterTransitionLoading(true); setWatchlistExclude(v); },
    hideWatched: effectiveHideWatched,
    setHideWatched: (v: boolean) => { setIsFilterTransitionLoading(true); setHideWatched(v); },
    watchedOnly: effectiveWatchedOnly,
    setWatchedOnly: (v: boolean) => { setIsFilterTransitionLoading(true); setWatchedOnly(v); },
    canUseWatchlistFilter: hasLetterboxdUsername,
    selectedShowtimeFilter,
    setSelectedShowtimeFilter: (v: typeof selectedShowtimeFilter) => {
      setIsFilterTransitionLoading(true);
      setSelectedShowtimeFilter(v);
    },
    showStatusFilter: isSignedIn,
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
    onOpenFilters: () => openFiltersModal({ showGroupByMovie: true, showPresets: true }),
    cinemaFilterDisabled: isSearchingByCinema,
    onClearAll: () => {
      setIsFilterTransitionLoading(true);
      setSelectedShowtimeFilter('all');
      setWatchlistOnly(false);
      setWatchlistExclude(false);
      setHideWatched(false);
      setWatchedOnly(false);
      setGroupByMovie(false);
      setSelectedDays([]);
      setSelectedTimeRanges([]);
      setSelectedRuntimeRanges([]);
      setSelectedListIds([]);
      setExcludeListIds([]);
      setSelectedLanguages([]);
      if (preferredCinemaIds) setSessionCinemaIds(preferredCinemaIds);
    },
  };

  // Same notice under either feed's empty state: the search field is shared by
  // both, and so is the reason an unexpected empty result turns up.
  const searchFieldFallback = (
    <SearchFieldFallback
      searchField={searchField}
      query={effectiveSearchQuery}
      onSearchByTitle={() => setSearchField('title')}
    />
  );

  // Pull-to-refresh no longer clears the list: RefreshControl's own spinner
  // at the top already says a reload is happening, so the old cards just
  // stay up and get swapped for the fresh ones once they land. A filter
  // change still clears it: switching mode mounts a whole feed from nothing,
  // and mounting it full of cards is the one piece of work heavy enough to
  // stall the filter row's animation on its way past.
  const visibleMovies = isFilterTransitionLoading ? [] : movies;

  // `!refreshing`: RefreshControl's own spinner already covers a
  // pull-to-refresh, so the panel has nothing to do for one even on an
  // already-empty list. A genuine first load and a background refetch go
  // through the same delay+cooldown — a preset or filter combo that's been
  // used before (or just hits a nearby cache entry) very often resolves
  // faster than LOADING_LOGO_DELAY_MS even with nothing cached yet, so
  // showing `moviesLoading` immediately just moved the flash from "quick
  // filter taps" to "quick presets" instead of removing it.
  const isMoviesFetchEmptyLoading =
    (moviesLoading || moviesFetching || isAwaitingMovies) &&
    !refreshing &&
    visibleMovies.length === 0;
  const showMoviesFetchLoadingLogo = useDelayedTrue(
    isMoviesFetchEmptyLoading,
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
  const isMoviesEmptyLoading = isMoviesFetchEmptyLoading || isFilterTransitionLoading;
  const showMoviesLoadingLogo = showMoviesFetchLoadingLogo || showTransitionLoadingLogo;

  const renderMoviesEmpty = () => {
    // The loading panel is a fixed overlay (below), not part of the list's
    // own content, so there's nothing to render here while it's up. And
    // never the "nothing found" copy while a refresh is in flight either —
    // the pull gesture's own spinner already covers that, and this would
    // otherwise flash up for an already-empty list mid-refresh even though
    // the loading panel is deliberately skipped for that case.
    //
    // A stand-in view rather than `null` while empty/refreshing — see the
    // matching comment in `ShowtimesScreen.tsx`'s `renderEmpty`: an empty
    // content container during a refresh is what let iOS's RefreshControl
    // render a duplicate spinner mid-scrollbox.
    if (isMoviesEmptyLoading || refreshing) return <View style={styles.emptyPlaceholder} />;
    return (
      <ThemedView style={styles.centerContainer}>
        <ThemedText style={styles.emptyText}>No movies found</ThemedText>
        {searchFieldFallback}
      </ThemedView>
    );
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
          <FiltersButton onPress={handleOpenFiltersModal} buttonRef={filtersButtonRef} />
        }
      />
      <PresetsRow onApplyPreset={handleApplyPreset} />
      <ActiveFilterChips {...activeChipsProps} />
      {appliedGroupByMovie ? (
        <View style={styles.listWrapper}>
          <FlatList
            ref={moviesListRef}
            data={visibleMovies}
            renderItem={renderMovie}
            keyExtractor={byIdKeyExtractor}
            contentContainerStyle={[styles.movieFeed, pullToRefreshContentStyle]}
            {...pullToRefreshScrollProps}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={renderMoviesEmpty}
            ListFooterComponent={<LoadMoreFooter loading={moviesFetchingNextPage} />}
            onScrollBeginDrag={loadMoreMovies.onScrollBeginDrag}
            onEndReached={loadMoreMovies.onEndReached}
            onEndReachedThreshold={2}
            refreshControl={<ThemedRefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
          />
          {/* An overlay, not the list's ListEmptyComponent: that content
              scrolls and shifts with RefreshControl's pull, which read as the
              logo drifting down the screen. Sitting outside the FlatList
              keeps it fixed in place and (via pointerEvents="none") never
              intercepts the pull-to-refresh gesture underneath it. */}
          {showMoviesLoadingLogo ? (
            <View style={styles.loadingOverlay} pointerEvents="none">
              <ListLoadingLogo />
            </View>
          ) : null}
        </View>
      ) : (
        <ShowtimesListContent
          listRef={showtimesListRef}
          showtimes={visibleShowtimes}
          isLoading={showtimesLoading || isAwaitingShowtimes}
          isFetching={showtimesFetching}
          immediateEmptyLoading={isFilterTransitionLoading}
          isFetchingNextPage={showtimesFetchingNextPage}
          hasNextPage={showtimesHasNextPage}
          onLoadMore={() => {
            if (!showtimesHasNextPage || showtimesFetchingNextPage) return false;
            return showtimesFetchNextPage();
          }}
          refreshing={refreshing}
          onRefresh={handleRefresh}
          emptyText="No showtimes found"
          emptyExtra={searchFieldFallback}
          openModalOptions={SHOWTIME_MODAL_OPTIONS}
          inheritFiltersOnMovieNav
        />
      )}
      {/* Floats over whichever feed is on screen, so it goes after both. */}
      <CinevilleCardButton surface="showtimes" />
      {/* Renders nothing inline: the tip, if any, is a modal over the screen. */}
      <FeatureTipsHost />
      {isShowingIntroFiltersSpotlight ? (
        <IntroFiltersSpotlight
          targetRef={filtersButtonRef}
          onOpenFilters={handleOpenFiltersModal}
        />
      ) : null}
    </TopSafeAreaView>
  );
}

const createStyles = (colors: typeof import('@/constants/theme').Colors.light) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    listWrapper: { flex: 1 },
    loadingOverlay: { ...StyleSheet.absoluteFill },
    movieFeed: { ...tabletCappedContentStyle, padding: 16 },
    centerContainer: { paddingVertical: 40, alignItems: 'center' },
    emptyText: { fontSize: 16, color: colors.textSecondary },
    emptyPlaceholder: { minHeight: EMPTY_PLACEHOLDER_MIN_HEIGHT },
  });

/**
 * The shell in front of the screen above.
 *
 * A tab is built the first time it is opened, and until it is, the tab you
 * pressed away from stays on screen — which reads as the press being ignored.
 * The gate is a component of its own so that every hook the screen owns lives
 * *behind* it: an early return inside one component would only defer the
 * render, not the queries and subscriptions that set it up.
 *
 * The wait is whatever {@link tabContentHoldMs} still owes the tab bar's press
 * flash, so the mount takes the UI thread only once that movement is over
 * rather than stalling it half-way. Once a tab has been built it is never
 * gated again.
 */
export default function MainShowtimesScreenTab() {
  const ready = useDeferredMount('tab:index', tabContentHoldMs);
  if (!ready) return <TabScreenSkeleton />;
  return <MainShowtimesScreen />;
}
