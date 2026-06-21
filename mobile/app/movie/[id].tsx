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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import TopSafeAreaView from "@/components/layout/TopSafeAreaView";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import type { MovieLoggedIn, ShowtimeInMovieLoggedIn } from "shared";
import { MoviesService } from "shared";
import { useFetchMovieShowtimes } from "shared/hooks/useFetchMovieShowtimes";

import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { ThemedText } from "@/components/themed-text";
import ShowtimeRow from "@/components/showtimes/ShowtimeRow";
import { ListEndFooter } from "@/components/showtimes/ShowtimesScreen";
import { useShowtimeModal } from "@/components/showtimes/ShowtimeModalProvider";
import FiltersModal from "@/components/filters/FiltersModal";
import CinemaFilterModal from "@/components/filters/CinemaFilterModal";
import ActiveFilterChips from "@/components/filters/ActiveFilterChips";
import { resolveDaySelectionsForApi } from "@/components/filters/day-filter-utils";
import { getSelectedStatusesFromShowtimeFilter } from "@/components/filters/shared-tab-filters";
import { useThemeColors } from "@/hooks/use-theme-color";
import { useSharedTabFilters } from "@/hooks/useSharedTabFilters";
import { useFetchSelectedCinemas } from "shared/hooks/useFetchSelectedCinemas";
import { buildSnapshotTime, refreshInfiniteQueryWithFreshSnapshot } from "@/utils/reset-infinite-query";
import { triggerSelectionHaptic } from "@/utils/long-press";
import { createShowtimeStatusGlowStyles } from "@/components/showtimes/showtime-glow";
import { useDeferredMount } from "@/utils/use-deferred-mount";

const SHOWTIMES_PAGE_SIZE = 20;

type MovieShowtimeSection = {
  key: string;
  title: string;
  data: ShowtimeInMovieLoggedIn[];
};

type MovieStyles = ReturnType<typeof createStyles>;

type MovieContentProps = {
  id: string;
  showtimeId?: string | string[];
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
  const { id, showtimeId } = useLocalSearchParams<{
    id: string;
    showtimeId?: string | string[];
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
          hitSlop={8}
          activeOpacity={0.6}
        >
          <MaterialIcons name="arrow-back" size={22} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>
      {contentReady ? (
        <MovieContent id={id} showtimeId={showtimeId} />
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
        <View style={[styles.poster, styles.skeletonBone]} />
        <View style={styles.summaryInfo}>
          <View style={[styles.skeletonBone, { height: 24, width: "75%", borderRadius: 5 }]} />
          <View style={[styles.skeletonBone, { height: 13, width: "50%", borderRadius: 4, marginTop: 6 }]} />
          <View style={[styles.skeletonBone, { height: 12, width: "65%", borderRadius: 4, marginTop: 4 }]} />
        </View>
      </View>
      <View style={styles.divider} />
      <View style={styles.filterRow}>
        <View style={[styles.skeletonBone, { height: 32, width: 88, borderRadius: 18 }]} />
      </View>
      <View style={styles.divider} />
      <View style={styles.skeletonList}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={[styles.skeletonBone, styles.skeletonCard]} />
        ))}
      </View>
    </>
  );
}

function MovieContent({ id, showtimeId }: MovieContentProps) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const isFetchingMoreRef = useRef(false);
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const { openShowtimeModal } = useShowtimeModal();

  const [filtersModalVisible, setFiltersModalVisible] = useState(false);
  const [cinemaModalVisible, setCinemaModalVisible] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const {
    selectedShowtimeFilter,
    appliedShowtimeFilter,
    setSelectedShowtimeFilter,
    selectedDays,
    setSelectedDays,
    selectedTimeRanges,
    setSelectedTimeRanges,
    selectedRuntimeRanges,
    setSelectedRuntimeRanges,
    selectedLanguages,
    setSelectedLanguages,
    sessionCinemaIds,
    setSessionCinemaIds,
  } = useSharedTabFilters();
  const { data: preferredCinemaIds } = useFetchSelectedCinemas();

  const movieId = useMemo(() => Number(id), [id]);
  const [snapshotTime, setSnapshotTime] = useState(() => buildSnapshotTime());

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
    enabled: Number.isFinite(movieId) && movieId > 0,
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
    if (!Number.isFinite(movieId) || movieId <= 0) return;
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
    openShowtimeModal({ ...matchingShowtime, movie }, { openedFrom: { movieId } });
  }, [targetShowtimeId, showtimes, movie, openShowtimeModal, movieId]);

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
              <Image source={{ uri: movie.poster_link ?? undefined }} style={styles.poster} />
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
              ) : movie.release_year ? (
                <ThemedText style={styles.directorText}>{movie.release_year}</ThemedText>
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
            sections={showtimeSections}
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
                    if (movie) openShowtimeModal({ ...item, movie }, { openedFrom: { movieId } });
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
            refreshing={refreshing}
            onRefresh={handleRefresh}
            onEndReached={handleEndReached}
            onEndReachedThreshold={0.4}
            ListEmptyComponent={
              isShowtimesLoading ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="large" color={colors.tint} />
                </View>
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
              ) : !hasNextPage && !isShowtimesLoading && showtimes.length > 0 ? (
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
      gap: 5,
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
    skeletonBone: {
      backgroundColor: colors.posterPlaceholder,
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
