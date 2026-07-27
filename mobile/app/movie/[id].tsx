/**
 * Expo Router screen/module for movie / [id]. It controls navigation and screen-level state for this route.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  SectionList,
  Image,
  StyleSheet,
  TouchableOpacity,
  View,
  Linking,
} from "react-native";
import { ThemedRefreshControl } from "@/components/themed-refresh-control";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import TopSafeAreaView from "@/components/layout/TopSafeAreaView";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import type { Language } from "shared/client";
import type { MovieLoggedIn, ShowtimeInMovieLoggedIn } from "shared";
import { MoviesService, ShowtimesService } from "shared";
import { useFetchMovieShowtimes } from "shared/hooks/useFetchMovieShowtimes";
import { usePrefetchShowtimeVisibility } from "shared/hooks/useShowtimeVisibility";

import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { ThemedText } from "@/components/themed-text";
import FriendWatchListModal from "@/components/friends/FriendWatchListModal";
import {
  getFriendWatchKindMeta,
  type FriendWatchKind,
} from "@/components/friends/friend-watch-kind";
import ShowtimeRow from "@/components/showtimes/ShowtimeRow";
import { ListEndFooter } from "@/components/showtimes/ShowtimesScreen";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { Skeleton } from "@/components/ui/Skeleton";
import PosterPlaceholder from "@/components/ui/PosterPlaceholder";
import { useShowtimeModal } from "@/components/showtimes/ShowtimeModalProvider";
import FiltersModal from "@/components/filters/FiltersModal";
import CinemaFilterModal from "@/components/filters/CinemaFilterModal";
import ActiveFilterChips from "@/components/filters/ActiveFilterChips";
import { resolveDaySelectionsForApi } from "@/components/filters/day-filter-utils";
import {
  getSelectedStatusesFromShowtimeFilter,
  type SharedTabShowtimeFilter,
} from "@/components/filters/shared-tab-filters";
import { useThemeColors } from "@/hooks/use-theme-color";
import { useSharedTabFilters } from "@/hooks/useSharedTabFilters";
import { useFetchSelectedCinemas } from "shared/hooks/useFetchSelectedCinemas";
import { buildSnapshotTime, refreshInfiniteQueryWithFreshSnapshot } from "@/utils/reset-infinite-query";
import { triggerSelectionHaptic } from "@/utils/long-press";
import { formatLanguageCode } from "@/utils/language";
import {
  UNKNOWN_METADATA_PLACEHOLDER,
  isSyntheticMovieId,
} from "@/constants/synthetic-movies";
import { createShowtimeStatusGlowStyles } from "@/components/showtimes/showtime-glow";
import { useDeferredMount } from "@/utils/use-deferred-mount";

const SHOWTIMES_PAGE_SIZE = 20;

/** Horizontal gap between the watchlisted/watched markers. */
const WATCH_MARKER_GAP = 8;

type MovieShowtimeSection = {
  key: string;
  title: string;
  data: ShowtimeInMovieLoggedIn[];
};

type MovieStyles = ReturnType<typeof createStyles>;

type MovieContentProps = {
  id: string;
  showtimeId?: string | string[];
  inheritFilters?: string | string[];
  cinemaId?: string | string[];
};

/**
 * Lightweight route shell. Renders only the header + skeleton on the first
 * frame so the native push animation can start immediately, then mounts the
 * data-fetching MovieContent after the transition's interactions settle.
 * Without this split, Android waits for MovieContent's expensive first render
 * (filter hooks + queries) to commit before it begins the slide.
 */
export default function MoviePage() {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const router = useRouter();
  const { id, showtimeId, inheritFilters, cinemaId } = useLocalSearchParams<{
    id: string;
    showtimeId?: string | string[];
    inheritFilters?: string | string[];
    cinemaId?: string | string[];
  }>();

  const contentReady = useDeferredMount(`movie:${id}`);

  return (
    <TopSafeAreaView style={styles.container}>
      <View style={styles.compactHeader}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => router.back()}
          style={styles.compactBackButton}
          // 22pt icon + 12 each side clears the 44pt minimum touch target.
          hitSlop={12}
          activeOpacity={0.6}
        >
          <MaterialIcons name="arrow-back" size={22} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>
      {contentReady ? (
        <MovieContent
          id={id}
          showtimeId={showtimeId}
          inheritFilters={inheritFilters}
          cinemaId={cinemaId}
        />
      ) : (
        <MovieSkeleton styles={styles} />
      )}
    </TopSafeAreaView>
  );
}

function MovieSkeleton({ styles }: { styles: MovieStyles }) {
  return (
    <>
      <View style={styles.staticHeader}>
        <Skeleton style={styles.poster} />
        <View style={styles.summaryInfo}>
          <Skeleton style={{ height: 24, width: "75%", borderRadius: 5 }} />
          <Skeleton style={{ height: 13, width: "50%", borderRadius: 4, marginTop: 6 }} />
          <Skeleton style={{ height: 12, width: "65%", borderRadius: 4, marginTop: 4 }} />
        </View>
      </View>
      <View style={styles.divider} />
      <View style={styles.filterRow}>
        <Skeleton style={{ height: 32, width: 88, borderRadius: 18 }} />
      </View>
      <View style={styles.divider} />
      <View style={styles.skeletonList}>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} style={styles.skeletonCard} />
        ))}
      </View>
    </>
  );
}

function MovieContent({ id, showtimeId, inheritFilters, cinemaId }: MovieContentProps) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const isFetchingMoreRef = useRef(false);
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const { openShowtimeModal } = useShowtimeModal();

  const [filtersModalVisible, setFiltersModalVisible] = useState(false);
  const [cinemaModalVisible, setCinemaModalVisible] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Which "watchlisted/watched by friends" popup is open, if any.
  const [watchModalKind, setWatchModalKind] = useState<FriendWatchKind | null>(null);

  // The tabs' filters (status/day/time/language) are page-scoped here: they only
  // carry over when `inheritFilters` says this page was opened from the
  // showtimes tab (or a modal opened from it). Cinema selection stays the one
  // global "my cinemas" preference shared everywhere.
  const shared = useSharedTabFilters();
  const { sessionCinemaIds, setSessionCinemaIds } = shared;
  const { data: preferredCinemaIds } = useFetchSelectedCinemas();

  const shouldInheritFilters = useMemo(
    () => (Array.isArray(inheritFilters) ? inheritFilters[0] : inheritFilters) === "1",
    [inheritFilters]
  );

  const [selectedShowtimeFilter, setSelectedShowtimeFilter] = useState<SharedTabShowtimeFilter>(
    () => (shouldInheritFilters ? shared.appliedShowtimeFilter : "all")
  );
  const [selectedDays, setSelectedDays] = useState<string[]>(
    () => (shouldInheritFilters ? shared.selectedDays : [])
  );
  const [selectedTimeRanges, setSelectedTimeRanges] = useState<string[]>(
    () => (shouldInheritFilters ? shared.selectedTimeRanges : [])
  );
  const [selectedRuntimeRanges, setSelectedRuntimeRanges] = useState<string[]>(
    () => (shouldInheritFilters ? shared.selectedRuntimeRanges : [])
  );
  const [selectedLanguages, setSelectedLanguages] = useState<Language[]>(
    () => (shouldInheritFilters ? shared.selectedLanguages : [])
  );
  const appliedShowtimeFilter = selectedShowtimeFilter;

  const movieId = useMemo(() => Number(id), [id]);
  const [snapshotTime, setSnapshotTime] = useState(() => buildSnapshotTime());

  // Safety net: if the showtime that led here belongs to a cinema the global
  // cinema filter excludes, fall back to "all cinemas" so it's still visible.
  const originCinemaId = useMemo(() => {
    const normalized = Array.isArray(cinemaId) ? cinemaId[0] : cinemaId;
    const parsed = Number.parseInt(normalized?.trim() ?? "", 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }, [cinemaId]);

  useEffect(() => {
    if (originCinemaId === null) return;
    if (sessionCinemaIds && sessionCinemaIds.length > 0 && !sessionCinemaIds.includes(originCinemaId)) {
      setSessionCinemaIds(undefined);
    }
  }, [originCinemaId, sessionCinemaIds, setSessionCinemaIds]);

  const dayAnchorKey =
    DateTime.now().setZone("Europe/Amsterdam").startOf("day").toISODate() ?? "";
  const resolvedApiDays = useMemo(
    () =>
      resolveDaySelectionsForApi(selectedDays, {
        startDate: DateTime.fromISO(dayAnchorKey, { zone: "Europe/Amsterdam" }),
      }),
    [dayAnchorKey, selectedDays]
  );

  const targetShowtimeId = useMemo(() => {
    const normalizedShowtimeId = Array.isArray(showtimeId)
      ? showtimeId[0]
      : showtimeId;
    const parsed = Number.parseInt(normalizedShowtimeId?.trim() ?? "", 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }, [showtimeId]);

  // Notifications/pings only carry a showtime id, not its cinema — fetch the
  // showtime directly (bypassing the cinema filter) so the same fallback applies.
  const handledTargetCinemaRef = useRef<number | null>(null);
  useEffect(() => {
    if (targetShowtimeId === null || originCinemaId !== null) return;
    if (handledTargetCinemaRef.current === targetShowtimeId) return;
    handledTargetCinemaRef.current = targetShowtimeId;
    let cancelled = false;
    void (async () => {
      try {
        const fetched = await ShowtimesService.getShowtimeById({ showtimeId: targetShowtimeId });
        if (cancelled) return;
        const fetchedCinemaId = fetched.cinema?.id;
        if (
          fetchedCinemaId !== undefined &&
          sessionCinemaIds &&
          sessionCinemaIds.length > 0 &&
          !sessionCinemaIds.includes(fetchedCinemaId)
        ) {
          setSessionCinemaIds(undefined);
        }
      } catch {
        // Ignore — the modal-open effect below already handles an unresolvable showtime.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [targetShowtimeId, originCinemaId, sessionCinemaIds, setSessionCinemaIds]);

  const showtimesFilters = useMemo(() => ({
    selectedCinemaIds: sessionCinemaIds,
    days: resolvedApiDays,
    timeRanges: selectedTimeRanges.length > 0 ? selectedTimeRanges : undefined,
    selectedStatuses: getSelectedStatusesFromShowtimeFilter(appliedShowtimeFilter),
    selectedLanguages: selectedLanguages.length > 0 ? selectedLanguages : undefined,
  }), [resolvedApiDays, appliedShowtimeFilter, selectedTimeRanges, sessionCinemaIds, selectedLanguages]);

  const { data: movie, isLoading: isMovieLoading, isError: isMovieError } = useQuery<MovieLoggedIn, Error>({
    queryKey: ["movie", movieId],
    queryFn: () =>
      MoviesService.readMovie({
        id: movieId,
        snapshotTime,
        showtimeLimit: 0,
      }),
    // `!== 0` (not `> 0`): synthetic listings like sneak previews use negative
    // movie ids. 0 and NaN remain invalid.
    enabled: Number.isFinite(movieId) && movieId !== 0,
  });

  const {
    data: showtimesData,
    isLoading: isShowtimesLoading,
    isError: isShowtimesError,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useFetchMovieShowtimes({
    movieId,
    limit: SHOWTIMES_PAGE_SIZE,
    snapshotTime,
    filters: showtimesFilters,
  });

  const showtimes = useMemo(() => showtimesData?.pages.flat() ?? [], [showtimesData]);
  // Each row here opens the showtime sheet, so its visibility mode is fetched
  // up front — including for a showtime deep-linked via `targetShowtimeId`.
  usePrefetchShowtimeVisibility(showtimes.map((showtime) => showtime.id));

  const showtimeSections = useMemo<MovieShowtimeSection[]>(() => {
    const sectionMap = new Map<string, MovieShowtimeSection>();
    const sectionOrder: string[] = [];

    for (const showtime of showtimes) {
      const showtimeDate = DateTime.fromISO(showtime.datetime).setZone("Europe/Amsterdam");
      const dateKey = showtimeDate.isValid
        ? (showtimeDate.toISODate() ?? showtime.datetime)
        : showtime.datetime;
      const existingSection = sectionMap.get(dateKey);
      if (existingSection) {
        existingSection.data.push(showtime);
        continue;
      }

      sectionMap.set(dateKey, {
        key: `date-${dateKey}`,
        title: showtimeDate.isValid ? showtimeDate.toFormat("cccc, d LLLL") : showtime.datetime,
        data: [showtime],
      });
      sectionOrder.push(dateKey);
    }

    return sectionOrder.map((key) => sectionMap.get(key)!).filter(Boolean);
  }, [showtimes]);

  const handleEndReached = () => {
    if (!hasNextPage || isFetchingNextPage || isFetchingMoreRef.current) return;
    isFetchingMoreRef.current = true;
    void fetchNextPage().finally(() => {
      isFetchingMoreRef.current = false;
    });
  };

  const handleRefresh = async () => {
    if (!Number.isFinite(movieId) || movieId === 0) return;
    setRefreshing(true);
    try {
      await refreshInfiniteQueryWithFreshSnapshot<ShowtimeInMovieLoggedIn[]>({
        queryClient,
        queryKey: ["movie", movieId, "showtimes", showtimesFilters],
        setSnapshotTime,
      });
      await queryClient.invalidateQueries({ queryKey: ["movie", movieId] });
    } finally {
      setRefreshing(false);
    }
  };

  const isSynthetic = movie ? isSyntheticMovieId(movie.id) : false;

  const runtimeLanguageLabel =
    [movie?.duration ? `${movie.duration} min` : null, formatLanguageCode(movie?.original_language)]
      .filter(Boolean)
      .join("  ·  ") || (isSynthetic ? `${UNKNOWN_METADATA_PLACEHOLDER} min` : "");

  const letterboxdSlug = movie?.letterboxd_slug?.trim() ?? "";
  const letterboxdSearchQuery = movie?.title
    ? `${movie.title}${movie.release_year ? ` ${movie.release_year}` : ""}`
    : "";
  const letterboxdSearchUrl = letterboxdSearchQuery
    ? `https://letterboxd.com/search/${encodeURIComponent(letterboxdSearchQuery)}/`
    : null;
  const letterboxdUrl = letterboxdSlug
    ? `https://letterboxd.com/film/${letterboxdSlug}`
    : letterboxdSearchUrl;

  const handleOpenLetterboxd = async () => {
    if (!letterboxdUrl) return;
    try {
      await Linking.openURL(letterboxdUrl);
    } catch {
      // Ignore open failures to keep the movie page interaction non-blocking.
    }
  };

  const openedTargetRef = useRef<number | null>(null);
  useEffect(() => {
    if (targetShowtimeId === null || !movie || showtimes.length === 0) return;
    if (openedTargetRef.current === targetShowtimeId) return;

    const matchingShowtime = showtimes.find((showtime) => showtime.id === targetShowtimeId);
    if (!matchingShowtime) return;

    openedTargetRef.current = targetShowtimeId;
    openShowtimeModal(
      {
        ...matchingShowtime,
        movie,
        friends_watchlisted: movie.friends_watchlisted ?? [],
        friends_watched: movie.friends_watched ?? [],
      },
      { openedFrom: { movieId } }
    );
  }, [targetShowtimeId, showtimes, movie, openShowtimeModal, movieId]);

  // Friends' Letterboxd relationship to this film — same markers as the showtime
  // sheet: icon + count only, in their own right-hand column of the header.
  // Tapping one opens the list, which is where the relationship is spelled out.
  // Only the non-empty relationships get a marker.
  const friendsWatchlisted = movie?.friends_watchlisted ?? [];
  const friendsWatched = movie?.friends_watched ?? [];
  const watchMarkers = (
    [
      { kind: "watchlisted" as const, count: friendsWatchlisted.length },
      { kind: "watched" as const, count: friendsWatched.length },
    ]
  )
    .filter((entry) => entry.count > 0)
    .map((entry) => ({ ...entry, meta: getFriendWatchKindMeta(entry.kind, colors) }));

  return (
    <>
      {isMovieLoading ? (
        <MovieSkeleton styles={styles} />
      ) : isMovieError || !movie ? (
        <View style={styles.centered}>
          <ThemedText style={styles.errorText}>Could not load movie.</ThemedText>
        </View>
      ) : (
        <>
          {/* Static movie header — stays fixed while showtimes scroll */}
          <View style={styles.staticHeader}>
            <TouchableOpacity
              onPress={handleOpenLetterboxd}
              activeOpacity={0.85}
              disabled={!letterboxdUrl}
            >
              {isSynthetic ? (
                <PosterPlaceholder style={styles.poster} glyphSize={40} />
              ) : (
                <Image source={{ uri: movie.poster_link ?? undefined }} style={styles.poster} />
              )}
            </TouchableOpacity>
            <View style={styles.summaryInfo}>
              <ThemedText style={styles.movieTitle} numberOfLines={3}>
                {movie.title}
              </ThemedText>
              {movie.original_title ? (
                <ThemedText style={styles.originalTitle} numberOfLines={2}>{movie.original_title}</ThemedText>
              ) : null}
              {movie.directors && movie.directors.length > 0 ? (
                <ThemedText style={styles.directorText} numberOfLines={2}>
                  <ThemedText style={styles.directorLabel}>DIRECTED BY </ThemedText>
                  {movie.directors.join(", ")}
                  {movie.release_year ? ` (${movie.release_year})` : null}
                </ThemedText>
              ) : isSynthetic ? (
                <ThemedText style={styles.directorText} numberOfLines={2}>
                  <ThemedText style={styles.directorLabel}>DIRECTED BY </ThemedText>
                  {`${UNKNOWN_METADATA_PLACEHOLDER} (${UNKNOWN_METADATA_PLACEHOLDER})`}
                </ThemedText>
              ) : movie.release_year ? (
                <ThemedText style={styles.directorText}>{movie.release_year}</ThemedText>
              ) : null}
              {movie.cast && movie.cast.length > 0 ? (
                <ThemedText style={styles.metaText} numberOfLines={2}>
                  <ThemedText style={styles.metaLabel}>STARRING </ThemedText>
                  {movie.cast.slice(0, 3).join(", ")}
                </ThemedText>
              ) : null}
              {/* Bottom line of the header: runtime · language on the left, the
                  watch markers pushed to the right. They ride along on an
                  existing line rather than claiming a column of their own, so
                  the title and director keep the full width and the header
                  gains no height. */}
              {runtimeLanguageLabel || watchMarkers.length > 0 ? (
                <View style={styles.metaFooterRow}>
                  <ThemedText style={styles.metaFooterText} numberOfLines={1}>
                    {runtimeLanguageLabel}
                  </ThemedText>
                  {watchMarkers.length > 0 ? (
                    <View style={styles.watchMarkers}>
                      {watchMarkers.map((marker) => (
                        <TouchableOpacity
                          key={marker.kind}
                          style={styles.watchMarker}
                          onPress={() => {
                            triggerSelectionHaptic();
                            setWatchModalKind(marker.kind);
                          }}
                          // Half the row gap each, so the pills' touch areas meet
                          // without overlapping — the pill itself is only ~21pt tall.
                          hitSlop={{
                            top: 8,
                            bottom: 8,
                            left: WATCH_MARKER_GAP / 2,
                            right: WATCH_MARKER_GAP / 2,
                          }}
                          activeOpacity={0.7}
                          accessibilityRole="button"
                          accessibilityLabel={`${marker.meta.title} by ${marker.count} friend${
                            marker.count === 1 ? "" : "s"
                          }`}
                        >
                          <MaterialIcons
                            name={marker.meta.icon}
                            size={13}
                            color={marker.meta.accent}
                          />
                          <ThemedText style={styles.watchMarkerCount}>{marker.count}</ThemedText>
                        </TouchableOpacity>
                      ))}
                    </View>
                  ) : null}
                </View>
              ) : null}
            </View>
          </View>
          <View style={styles.divider} />
          <View style={styles.filterRow}>
            <TouchableOpacity style={styles.filterBtn} onPress={() => { triggerSelectionHaptic(); setFiltersModalVisible(true); }} activeOpacity={0.8}>
              <MaterialIcons name="tune" size={14} color={colors.pillText} />
              <ThemedText style={styles.filterBtnText}>Filters</ThemedText>
            </TouchableOpacity>
            <ActiveFilterChips
              inline
              onOpenFilters={() => { triggerSelectionHaptic(); setFiltersModalVisible(true); }}
              onOpenCinemaModal={() => setCinemaModalVisible(true)}
              groupByMovie={false}
              setGroupByMovie={() => {}}
              watchlistOnly={false}
              setWatchlistOnly={() => {}}
              hideWatched={false}
              setHideWatched={() => {}}
              selectedShowtimeFilter={selectedShowtimeFilter}
              setSelectedShowtimeFilter={setSelectedShowtimeFilter}
              showStatusFilter
              selectedDays={selectedDays}
              setSelectedDays={setSelectedDays}
              selectedTimeRanges={selectedTimeRanges}
              setSelectedTimeRanges={setSelectedTimeRanges}
              selectedRuntimeRanges={[]}
              setSelectedRuntimeRanges={() => {}}
              selectedLanguages={selectedLanguages}
              setSelectedLanguages={setSelectedLanguages}
              onClearAll={() => {
                setSelectedShowtimeFilter("all");
                setSelectedDays([]);
                setSelectedTimeRanges([]);
                setSelectedLanguages([]);
                if (preferredCinemaIds) setSessionCinemaIds(preferredCinemaIds);
              }}
            />
          </View>
          <View style={styles.divider} />
          <SectionList
            sections={refreshing ? [] : showtimeSections}
            keyExtractor={(item) => item.id.toString()}
            stickySectionHeadersEnabled
            renderItem={({ item }) => (
                <TouchableOpacity
                  style={[
                    styles.showtimeCardGlow,
                    item.going === "GOING"
                      ? styles.showtimeCardGlowGoing
                      : item.going === "INTERESTED"
                        ? styles.showtimeCardGlowInterested
                        : undefined,
                  ]}
                  onPress={() => {
                    if (movie)
                      openShowtimeModal(
                        {
                          ...item,
                          movie,
                          friends_watchlisted: movie.friends_watchlisted ?? [],
                          friends_watched: movie.friends_watched ?? [],
                        },
                        { openedFrom: { movieId } }
                      );
                  }}
                  activeOpacity={0.85}
                >
                  <View
                    style={[
                      styles.showtimeCard,
                      item.going === "GOING"
                        ? styles.showtimeCardGoing
                        : item.going === "INTERESTED"
                          ? styles.showtimeCardInterested
                        : undefined,
                    ]}
                  >
                    <ShowtimeRow
                      showtime={item}
                      showFriends
                      alignCinemaRight
                      showDate={false}
                      isSyntheticMovie={isSynthetic}
                    />
                  </View>
                </TouchableOpacity>
            )}
            renderSectionHeader={({ section }) => (
              <View style={styles.dateGroupHeader}>
                <ThemedText style={styles.dateGroupHeaderText}>{section.title}</ThemedText>
              </View>
            )}
            contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 16) }]}
            refreshControl={<ThemedRefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
            onEndReached={handleEndReached}
            onEndReachedThreshold={0.4}
            ListEmptyComponent={
              isShowtimesLoading || refreshing ? (
                <SkeletonRows height={64} />
              ) : isShowtimesError ? (
                <ThemedText style={styles.errorText}>Could not load showtimes.</ThemedText>
              ) : (
                <ThemedText style={styles.noShowtimes}>No upcoming showtimes</ThemedText>
              )
            }
            ListFooterComponent={
              isFetchingNextPage ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="small" color={colors.tint} />
                </View>
              ) : !hasNextPage && !isShowtimesLoading && !refreshing && showtimes.length > 0 ? (
                <ListEndFooter label="No more showtimes" />
              ) : null
            }
          />
        </>
      )}
      <FiltersModal
        visible={filtersModalVisible}
        onClose={() => setFiltersModalVisible(false)}
        groupByMovie={false}
        setGroupByMovie={() => {}}
        showGroupByMovie={false}
        watchlistOnly={false}
        setWatchlistOnly={() => {}}
        hideWatched={false}
        setHideWatched={() => {}}
        canUseWatchlistFilter={false}
        selectedShowtimeFilter={selectedShowtimeFilter}
        setSelectedShowtimeFilter={setSelectedShowtimeFilter}
        showStatusFilter
        showCinemas
        onOpenCinemaModal={() => setCinemaModalVisible(true)}
        showRuntime={false}
        selectedDays={selectedDays}
        setSelectedDays={setSelectedDays}
        selectedTimeRanges={selectedTimeRanges}
        setSelectedTimeRanges={setSelectedTimeRanges}
        selectedRuntimeRanges={selectedRuntimeRanges}
        setSelectedRuntimeRanges={setSelectedRuntimeRanges}
        selectedLanguages={selectedLanguages}
        setSelectedLanguages={setSelectedLanguages}
        resultCount={showtimes.length}
      />
      <CinemaFilterModal
        visible={cinemaModalVisible}
        onClose={() => setCinemaModalVisible(false)}
      />
      {/* Static list — a movie page has no single showtime to invite anyone to. */}
      <FriendWatchListModal
        kind={watchModalKind}
        friends={watchModalKind === "watched" ? friendsWatched : friendsWatchlisted}
        onClose={() => setWatchModalKind(null)}
      />
    </>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) => {
  const glowStyles = createShowtimeStatusGlowStyles(colors);
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    compactHeader: {
      height: 48,
      paddingHorizontal: 16,
      justifyContent: "center",
      backgroundColor: colors.background,
    },
    compactBackButton: {
      alignSelf: "flex-start",
    },
    content: {
      padding: 16,
      gap: 16,
    },
    staticHeader: {
      flexDirection: "row",
      gap: 14,
      paddingHorizontal: 16,
      paddingBottom: 16,
    },
    divider: {
      height: 1,
      backgroundColor: colors.divider,
      marginBottom: 0,
    },
    filterRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingLeft: 16,
      paddingVertical: 8,
      backgroundColor: colors.background,
    },
    filterBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      paddingHorizontal: 14,
      paddingVertical: 7,
      borderRadius: 18,
      backgroundColor: colors.pillBackground,
    },
    filterBtnText: {
      fontSize: 13,
      fontWeight: "500",
      color: colors.pillText,
    },
    centered: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
    },
    loadingContainer: {
      paddingVertical: 16,
      alignItems: "center",
    },
    errorText: {
      color: colors.textSecondary,
    },
    poster: {
      width: 110,
      height: 165,
      borderRadius: 8,
      backgroundColor: colors.posterPlaceholder,
    },
    summaryInfo: {
      flex: 1,
      gap: 1,
    },
    movieTitle: {
      fontSize: 22,
      fontWeight: "800",
      color: colors.text,
    },
    originalTitle: {
      fontSize: 13,
      color: colors.textSecondary,
      marginTop: -2,
    },
    directorText: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    directorLabel: {
      fontSize: 11,
      fontWeight: "800",
      letterSpacing: 0.6,
      color: colors.textSecondary,
    },
    metaText: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    metaLabel: {
      fontSize: 11,
      fontWeight: "800",
      letterSpacing: 0.6,
      color: colors.textSecondary,
    },
    metaFooterRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    metaFooterText: {
      flex: 1,
      fontSize: 12,
      color: colors.textSecondary,
    },
    // Negative vertical margin so the ~21pt pills sit inside the 15pt text line
    // they share instead of stretching the header — they overhang into the
    // 5pt gaps above and below, which hold nothing but background.
    watchMarkers: {
      flexDirection: "row",
      alignItems: "center",
      gap: WATCH_MARKER_GAP,
      marginVertical: -3,
    },
    // Neutral pill; only the icon carries the watchlisted/watched colour, so the
    // markers read as a quiet aside rather than a call to act. Same pill as
    // ShowtimeActionModal's, minus its `minWidth` — that keeps the sheet's
    // vertical stack from going ragged, and here it would only steal width from
    // the runtime line sharing the row.
    watchMarker: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 4,
      borderRadius: 999,
      paddingHorizontal: 7,
      paddingVertical: 3,
      backgroundColor: colors.pillBackground,
    },
    watchMarkerCount: {
      fontSize: 11,
      fontWeight: "600",
      color: colors.textSecondary,
    },
    dateGroupHeader: {
      marginTop: -6,
      paddingTop: 6,
      paddingBottom: 4,
      paddingHorizontal: 2,
      backgroundColor: colors.background,
    },
    dateGroupHeaderText: {
      fontSize: 13,
      fontWeight: "700",
      color: colors.textSecondary,
    },
    noShowtimes: {
      fontSize: 13,
      color: colors.textSecondary,
    },
    showtimeCardGlow: {
      borderRadius: 10,
      backgroundColor: colors.cardBackground,
    },
    skeletonList: {
      padding: 16,
      gap: 12,
    },
    skeletonCard: {
      height: 72,
      borderRadius: 10,
    },
    showtimeCardGlowGoing: glowStyles.going,
    showtimeCardGlowInterested: glowStyles.interested,
    showtimeCardGoing: {
      borderColor: colors.green.secondary,
      backgroundColor: colors.green.primary,
    },
    showtimeCardInterested: {
      borderColor: colors.orange.secondary,
      backgroundColor: colors.orange.primary,
    },
    showtimeCard: {
      borderWidth: 1,
      borderColor: colors.cardBorder,
      borderRadius: 10,
      padding: 10,
      backgroundColor: colors.cardBackground,
      gap: 6,
    },
  });
};
