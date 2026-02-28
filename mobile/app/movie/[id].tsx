/**
 * Expo Router screen/module for movie / [id]. It controls navigation and screen-level state for this route.
 */
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  StyleSheet,
  TouchableOpacity,
  View,
  Linking,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import type { GoingStatus, MovieLoggedIn, ShowtimeInMovieLoggedIn } from "shared";
import { MoviesService, ShowtimesService } from "shared";
import { useFetchMovieShowtimes } from "shared/hooks/useFetchMovieShowtimes";
import { useFetchSelectedCinemas } from "shared/hooks/useFetchSelectedCinemas";
import { useSessionCinemaSelections } from "shared/hooks/useSessionCinemaSelections";

import { ThemedText } from "@/components/themed-text";
import ShowtimeRow from "@/components/showtimes/ShowtimeRow";
import ShowtimeActionModal from "@/components/showtimes/ShowtimeActionModal";
import CinemaPresetQuickPopover from "@/components/filters/CinemaPresetQuickPopover";
import FilterPills, {
  type FilterPillLongPressPosition,
} from "@/components/filters/FilterPills";
import CinemaFilterModal from "@/components/filters/CinemaFilterModal";
import DayFilterModal from "@/components/filters/DayFilterModal";
import DayQuickPopover from "@/components/filters/DayQuickPopover";
import TimeQuickPopover from "@/components/filters/TimeQuickPopover";
import { formatDayPillLabel, resolveDaySelectionsForApi } from "@/components/filters/day-filter-utils";
import { formatTimePillLabel } from "@/components/filters/time-range-utils";
import { useThemeColors } from "@/hooks/use-theme-color";
import { useSharedDayTimeFilters } from "@/hooks/useSharedDayTimeFilters";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { isCinemaSelectionDifferentFromPreferred } from "@/utils/cinema-selection";
import { createShowtimeStatusGlowStyles } from "@/components/showtimes/showtime-glow";

const SHOWTIMES_PAGE_SIZE = 20;
// Filter pill definitions rendered in the top filter row.
const BASE_FILTERS = [
  { id: "showtime-filter", label: "Any Status" },
  { id: "cinemas", label: "Cinemas" },
  { id: "days", label: "Any Day" },
  { id: "times", label: "any time" },
];

type ShowtimeFilter = "all" | "going" | "interested";

export default function MoviePage() {
  // Read flow: local state and data hooks first, then handlers, then the JSX screen.
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const router = useRouter();
  // React Query client used for cache updates and invalidation.
  const queryClient = useQueryClient();
  // Safe-area inset values used to avoid notches/home indicators.
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  // Tracks the selected showtime-status mode (all / interested / going).
  const [selectedFilter, setSelectedFilter] = useState<ShowtimeFilter>("all");
  // Stores the showtime currently selected for status/ticket actions.
  const [selectedShowtime, setSelectedShowtime] = useState<ShowtimeInMovieLoggedIn | null>(null);
  // Controls visibility of the cinema-filter modal.
  const [cinemaModalVisible, setCinemaModalVisible] = useState(false);
  const [cinemaPresetPopoverVisible, setCinemaPresetPopoverVisible] = useState(false);
  const [cinemaPresetPopoverAnchor, setCinemaPresetPopoverAnchor] =
    useState<FilterPillLongPressPosition | null>(null);
  const [dayQuickPopoverVisible, setDayQuickPopoverVisible] = useState(false);
  const [dayQuickPopoverAnchor, setDayQuickPopoverAnchor] =
    useState<FilterPillLongPressPosition | null>(null);
  const [timeQuickPopoverVisible, setTimeQuickPopoverVisible] = useState(false);
  const [timeQuickPopoverAnchor, setTimeQuickPopoverAnchor] =
    useState<FilterPillLongPressPosition | null>(null);
  // Controls visibility of the day-filter modal.
  const [dayModalVisible, setDayModalVisible] = useState(false);
  const { selectedDays, setSelectedDays, selectedTimeRanges, setSelectedTimeRanges } =
    useSharedDayTimeFilters();
  const dayAnchorKey =
    DateTime.now().setZone("Europe/Amsterdam").startOf("day").toISODate() ?? "";
  const resolvedApiDays = useMemo(
    () => resolveDaySelectionsForApi(selectedDays),
    [dayAnchorKey, selectedDays]
  );

  // Convert route param to numeric movie ID for API calls/query keys.
  const movieId = useMemo(() => Number(id), [id]);
  // Keep one snapshot timestamp so list pages stay consistent while scrolling.
  const snapshotTime = useMemo(
    () => DateTime.now().setZone("Europe/Amsterdam").toFormat("yyyy-MM-dd'T'HH:mm:ss"),
    []
  );
  const { selections: sessionCinemaIds } = useSessionCinemaSelections();
  const { data: preferredCinemaIds } = useFetchSelectedCinemas();

  // UI filter state is translated into backend filter params here.
  const showtimesFilters = useMemo(() => {
    const selectedStatuses: GoingStatus[] | undefined =
      selectedFilter === "all"
        ? undefined
        : selectedFilter === "going"
          ? ["GOING"]
          : ["GOING", "INTERESTED"];

    return {
      selectedCinemaIds: sessionCinemaIds,
      days: resolvedApiDays,
      timeRanges: selectedTimeRanges.length > 0 ? selectedTimeRanges : undefined,
      selectedStatuses,
    };
  }, [resolvedApiDays, selectedFilter, selectedTimeRanges, sessionCinemaIds]);

  // Data hooks keep this module synced with backend data and shared cache state.
  const { data: movie, isLoading: isMovieLoading, isError: isMovieError } = useQuery<MovieLoggedIn, Error>({
    queryKey: ["movie", movieId, sessionCinemaIds ?? null],
    queryFn: () =>
      MoviesService.readMovie({
        id: movieId,
        snapshotTime,
        showtimeLimit: 0,
        selectedCinemaIds: sessionCinemaIds,
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

  // Flatten/derive list data for rendering efficiency.
  const showtimes = useMemo(() => showtimesData?.pages.flat() ?? [], [showtimesData]);
  // Request the next page when the list nears the end.
  const handleEndReached = () => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  };

  // Update all relevant query caches so the status chip updates instantly across screens.
  const updateShowtimeInCaches = (
    showtimeId: number,
    going: GoingStatus,
    seatRow: string | null,
    seatNumber: string | null
  ) => {
    queryClient.setQueriesData(
      { queryKey: ["movie", movieId, "showtimes"] },
      (oldData: unknown) => {
        if (!oldData || typeof oldData !== "object" || !("pages" in oldData)) {
          return oldData;
        }
        const data = oldData as { pages: ShowtimeInMovieLoggedIn[][]; pageParams: unknown[] };
        return {
          ...data,
          pages: data.pages.map((page) =>
            page.map((showtime) =>
              showtime.id === showtimeId
                ? { ...showtime, going, seat_row: seatRow, seat_number: seatNumber }
                : showtime
            )
          ),
        };
      }
    );

    queryClient.setQueriesData({ queryKey: ["movie", movieId] }, (oldData: unknown) => {
      if (!oldData || typeof oldData !== "object" || !("showtimes" in oldData)) {
        return oldData;
      }
      const data = oldData as MovieLoggedIn;
      return {
        ...data,
        showtimes: data.showtimes.map((showtime) =>
          showtime.id === showtimeId
            ? { ...showtime, going, seat_row: seatRow, seat_number: seatNumber }
            : showtime
        ),
      };
    });
  };

  const { mutate: updateShowtimeSelection, isPending: isUpdatingShowtimeSelection } = useMutation({
    mutationFn: ({
      showtimeId,
      going,
      seatRow,
      seatNumber,
    }: {
      showtimeId: number;
      going: GoingStatus;
      seatRow?: string | null;
      seatNumber?: string | null;
    }) => {
      const requestBody: {
        going_status: GoingStatus;
        seat_row?: string | null;
        seat_number?: string | null;
      } = {
        going_status: going,
      };
      if (seatRow !== undefined) {
        requestBody.seat_row = seatRow;
      }
      if (seatNumber !== undefined) {
        requestBody.seat_number = seatNumber;
      }
      return ShowtimesService.updateShowtimeSelection({
        showtimeId,
        requestBody,
      });
    },
    onMutate: async ({ showtimeId, going, seatRow, seatNumber }) => {
      // Pause active requests so optimistic updates are not immediately overwritten.
      await Promise.all([
        queryClient.cancelQueries({ queryKey: ["movie", movieId, "showtimes"] }),
        queryClient.cancelQueries({ queryKey: ["movie", movieId] }),
      ]);

      const previousMovieShowtimeQueries = queryClient.getQueriesData({
        queryKey: ["movie", movieId, "showtimes"],
      });
      const previousMovieQueries = queryClient.getQueriesData({
        queryKey: ["movie", movieId],
      });
      const previousSelectedShowtime = selectedShowtime;
      const nextSeatRow =
        going === "GOING"
          ? (seatRow ?? previousSelectedShowtime?.seat_row ?? null)
          : null;
      const nextSeatNumber =
        going === "GOING"
          ? (seatNumber ?? previousSelectedShowtime?.seat_number ?? null)
          : null;

      // Optimistic update for immediate UI feedback.
      updateShowtimeInCaches(showtimeId, going, nextSeatRow, nextSeatNumber);
      setSelectedShowtime((previous) =>
        previous
          ? {
              ...previous,
              going,
              seat_row: nextSeatRow,
              seat_number: nextSeatNumber,
            }
          : previous
      );

      return {
        previousMovieShowtimeQueries,
        previousMovieQueries,
        previousSelectedShowtime,
      };
    },
    onError: (_error, _variables, context) => {
      context?.previousMovieShowtimeQueries?.forEach(([queryKey, data]) => {
        queryClient.setQueryData(queryKey, data);
      });
      context?.previousMovieQueries?.forEach(([queryKey, data]) => {
        queryClient.setQueryData(queryKey, data);
      });
      setSelectedShowtime(context?.previousSelectedShowtime ?? null);
    },
    onSuccess: (updatedShowtime) => {
      // Ensure optimistic state matches backend-confirmed value.
      updateShowtimeInCaches(
        updatedShowtime.id,
        updatedShowtime.going,
        updatedShowtime.seat_row ?? null,
        updatedShowtime.seat_number ?? null
      );
      setSelectedShowtime((previous) =>
        previous && previous.id === updatedShowtime.id
          ? {
              ...previous,
              going: updatedShowtime.going,
              seat_row: updatedShowtime.seat_row ?? null,
              seat_number: updatedShowtime.seat_number ?? null,
            }
          : previous
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["movie", movieId, "showtimes"] });
      queryClient.invalidateQueries({ queryKey: ["movie", movieId] });
      queryClient.invalidateQueries({ queryKey: ["showtimes"] });
      queryClient.invalidateQueries({ queryKey: ["movies"] });
    },
  });

  // Submit the selected going/interested/not-going status.
  const handleShowtimeStatusUpdate = (
    going: GoingStatus,
    seat?: { seatRow: string | null; seatNumber: string | null }
  ) => {
    if (!selectedShowtime || isUpdatingShowtimeSelection) return;
    updateShowtimeSelection({
      showtimeId: selectedShowtime.id,
      going,
      seatRow: seat?.seatRow,
      seatNumber: seat?.seatNumber,
    });
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
  // Open the movie's Letterboxd page from the poster on the movie detail header.
  const handleOpenLetterboxd = async () => {
    if (!letterboxdUrl) return;
    try {
      await Linking.openURL(letterboxdUrl);
    } catch {
      // Ignore open failures to keep the movie page interaction non-blocking.
    }
  };

  // Handle filter pill presses and update active filter state.
  const handleSelectFilter = (
    filterId: string,
    position?: FilterPillLongPressPosition
  ) => {
    if (filterId === "showtime-filter") {
      // Tap cycles all -> interested -> going -> all for quick triaging.
      setSelectedFilter((prev) =>
        prev === "all" ? "interested" : prev === "interested" ? "going" : "all"
      );
      return;
    }
    if (filterId === "cinemas") {
      setCinemaPresetPopoverAnchor(position ?? null);
      setCinemaPresetPopoverVisible(true);
      return;
    }
    if (filterId === "days") {
      setDayQuickPopoverAnchor(position ?? null);
      setDayQuickPopoverVisible(true);
      return;
    }
    if (filterId === "times") {
      setTimeQuickPopoverAnchor(position ?? null);
      setTimeQuickPopoverVisible(true);
      return;
    }
  };

  const handleLongPressFilter = (
    filterId: string,
    position: FilterPillLongPressPosition
  ) => {
    if (filterId === "cinemas") {
      setCinemaModalVisible(true);
      return true;
    }
    if (filterId === "days") {
      setDayModalVisible(true);
      return true;
    }
    if (filterId === "times") {
      setTimeQuickPopoverAnchor(position ?? null);
      setTimeQuickPopoverVisible(true);
      return true;
    }
    return false;
  };

  // Build the filter payload from current UI selections.
  const pillFilters = useMemo(() => {
    return BASE_FILTERS.map((filter) => {
      if (filter.id === "showtime-filter") {
        const label =
          selectedFilter === "all"
            ? "Any Status"
            : selectedFilter === "going"
              ? "Going"
              : "Interested";
        return {
          ...filter,
          label,
          activeBackgroundColor:
            selectedFilter === "going"
              ? colors.green.primary
              : selectedFilter === "interested"
                ? colors.orange.primary
                : undefined,
          activeTextColor:
            selectedFilter === "going"
              ? colors.green.secondary
              : selectedFilter === "interested"
                ? colors.orange.secondary
                : undefined,
          activeBorderColor:
            selectedFilter === "going"
              ? colors.green.secondary
              : selectedFilter === "interested"
                ? colors.orange.secondary
                : undefined,
        };
      }
      if (filter.id === "days") {
        return { ...filter, label: formatDayPillLabel(selectedDays) };
      }
      if (filter.id === "times") {
        return { ...filter, label: formatTimePillLabel(selectedTimeRanges) };
      }
      return filter;
    });
  }, [colors, selectedDays, selectedFilter, selectedTimeRanges]);

  const isCinemaFilterActive = useMemo(
    () =>
      isCinemaSelectionDifferentFromPreferred({
        sessionCinemaIds,
        preferredCinemaIds,
      }),
    [sessionCinemaIds, preferredCinemaIds]
  );

  // Compute which filter pills should render as active.
  const activeFilterIds = useMemo(() => {
    const active: string[] = [];
    if (selectedFilter !== "all") {
      active.push("showtime-filter");
    }
    if (selectedDays.length > 0) {
      active.push("days");
    }
    if (selectedTimeRanges.length > 0) {
      active.push("times");
    }
    if (isCinemaFilterActive) {
      active.push("cinemas");
    }
    return active;
  }, [selectedFilter, selectedDays.length, selectedTimeRanges.length, isCinemaFilterActive]);

  // Render/output using the state and derived values prepared above.
  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <Stack.Screen
        options={{
          headerShown: false,
          animation: "none",
          contentStyle: { backgroundColor: colors.background },
        }}
      />
      <View style={styles.compactHeader}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => router.back()}
          style={styles.compactBackButton}
          hitSlop={8}
          activeOpacity={0.75}
        >
          <IconSymbol size={20} name="chevron.left" color={colors.tint} />
        </TouchableOpacity>
      </View>
      <ShowtimeActionModal
        visible={selectedShowtime !== null}
        showtime={selectedShowtime}
        movieTitle={movie?.title ?? ""}
        isUpdatingStatus={isUpdatingShowtimeSelection}
        onUpdateStatus={handleShowtimeStatusUpdate}
        onClose={() => setSelectedShowtime(null)}
      />
      {isMovieLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.tint} />
        </View>
      ) : isMovieError || !movie ? (
        <View style={styles.centered}>
          <ThemedText style={styles.errorText}>Could not load movie.</ThemedText>
        </View>
      ) : (
        <>
          <FlatList
            data={showtimes}
            keyExtractor={(item) => item.id.toString()}
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
                onPress={() => setSelectedShowtime(item)}
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
                  <ShowtimeRow showtime={item} showFriends alignCinemaRight />
                </View>
              </TouchableOpacity>
            )}
            contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 16) }]}
            onEndReached={handleEndReached}
            onEndReachedThreshold={0.4}
            ListHeaderComponent={
              <View style={styles.headerSection}>
                <View style={styles.header}>
                  <TouchableOpacity
                    onPress={handleOpenLetterboxd}
                    activeOpacity={0.85}
                    disabled={!letterboxdUrl}
                  >
                    <Image source={{ uri: movie.poster_link ?? undefined }} style={styles.poster} />
                  </TouchableOpacity>
                  <View style={styles.headerInfo}>
                    <ThemedText style={styles.title}>{movie.title}</ThemedText>
                    {movie.original_title ? (
                      <ThemedText style={styles.subtitle}>{movie.original_title}</ThemedText>
                    ) : null}
                    {movie.directors && movie.directors.length > 0 ? (
                      <ThemedText style={styles.meta}>Directed by {movie.directors.join(", ")}</ThemedText>
                    ) : null}
                    {movie.release_year ? (
                      <ThemedText style={styles.meta}>{movie.release_year}</ThemedText>
                    ) : null}
                  </View>
                </View>
                <ThemedText style={styles.sectionTitle}>Showtimes</ThemedText>
                <View style={styles.filterPillsWrapper}>
                  <FilterPills
                    filters={pillFilters}
                    selectedId=""
                    onSelect={handleSelectFilter}
                    onLongPressSelect={handleLongPressFilter}
                    activeIds={activeFilterIds}
                  />
                </View>
              </View>
            }
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
              ) : null
            }
          />
          <CinemaFilterModal
            visible={cinemaModalVisible}
            onClose={() => setCinemaModalVisible(false)}
          />
          <CinemaPresetQuickPopover
            visible={cinemaPresetPopoverVisible}
            anchor={cinemaPresetPopoverAnchor}
            onClose={() => setCinemaPresetPopoverVisible(false)}
            onOpenModal={() => setCinemaModalVisible(true)}
            maxPresets={6}
          />
          <DayQuickPopover
            visible={dayQuickPopoverVisible}
            anchor={dayQuickPopoverAnchor}
            onClose={() => setDayQuickPopoverVisible(false)}
            selectedDays={selectedDays}
            onChange={setSelectedDays}
            onOpenModal={() => setDayModalVisible(true)}
          />
          <TimeQuickPopover
            visible={timeQuickPopoverVisible}
            anchor={timeQuickPopoverAnchor}
            onClose={() => setTimeQuickPopoverVisible(false)}
            selectedTimeRanges={selectedTimeRanges}
            onChange={setSelectedTimeRanges}
          />
          <DayFilterModal
            visible={dayModalVisible}
            onClose={() => setDayModalVisible(false)}
            selectedDays={selectedDays}
            onChange={setSelectedDays}
          />
        </>
      )}
    </SafeAreaView>
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
      height: 30,
      paddingHorizontal: 8,
      justifyContent: "center",
      backgroundColor: colors.background,
    },
    compactBackButton: {
      alignItems: "center",
      justifyContent: "center",
      width: 28,
      height: 28,
    },
    content: {
      padding: 16,
      gap: 16,
    },
    headerSection: {
      gap: 16,
    },
    filterPillsWrapper: {
      marginHorizontal: -16,
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
    header: {
      flexDirection: "row",
      gap: 16,
      alignItems: "flex-start",
    },
    poster: {
      width: 120,
      height: 180,
      borderRadius: 8,
      backgroundColor: colors.posterPlaceholder,
    },
    headerInfo: {
      flex: 1,
      gap: 6,
    },
    title: {
      fontSize: 22,
      fontWeight: "700",
      color: colors.text,
    },
    subtitle: {
      fontSize: 14,
      color: colors.textSecondary,
    },
    meta: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: "700",
      color: colors.text,
    },
    noShowtimes: {
      fontSize: 13,
      color: colors.textSecondary,
    },
    showtimeCardGlow: {
      borderRadius: 10,
      backgroundColor: colors.cardBackground,
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
    statusModalBackdrop: {
      flex: 1,
      justifyContent: "center",
      padding: 20,
    },
    statusModalBlur: {
      ...StyleSheet.absoluteFillObject,
    },
    statusModalTint: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: "rgba(0, 0, 0, 0.06)",
    },
    statusModalDismissArea: {
      ...StyleSheet.absoluteFillObject,
    },
    statusModalCard: {
      backgroundColor: colors.cardBackground,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      padding: 14,
      gap: 10,
    },
    statusModalTitle: {
      fontSize: 18,
      fontWeight: "700",
      color: colors.text,
    },
    statusModalSubtitle: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    ticketButton: {
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.tint,
      backgroundColor: colors.cardBackground,
      alignItems: "center",
      paddingVertical: 9,
      paddingHorizontal: 12,
    },
    ticketButtonDisabled: {
      borderColor: colors.divider,
      backgroundColor: colors.pillBackground,
    },
    ticketButtonText: {
      fontSize: 13,
      fontWeight: "700",
      color: colors.tint,
    },
    ticketButtonTextDisabled: {
      color: colors.textSecondary,
    },
    statusButtons: {
      gap: 8,
      marginTop: 4,
    },
    statusButton: {
      borderRadius: 10,
      borderWidth: 1,
      paddingVertical: 10,
      paddingHorizontal: 12,
      alignItems: "center",
    },
    statusButtonGoing: {
      backgroundColor: colors.green.primary,
      borderColor: colors.green.secondary,
    },
    statusButtonInterested: {
      backgroundColor: colors.orange.primary,
      borderColor: colors.orange.secondary,
    },
    statusButtonNotGoing: {
      backgroundColor: colors.red.primary,
      borderColor: colors.red.secondary,
    },
    statusButtonActive: {
      borderWidth: 3,
      shadowColor: colors.text,
      shadowOpacity: 0.28,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 3 },
      elevation: 7,
      transform: [{ scale: 1.02 }],
    },
    statusButtonText: {
      fontSize: 14,
      fontWeight: "700",
      color: colors.text,
    },
    statusButtonTextActive: {
      fontWeight: "800",
    },
    statusCancelButton: {
      alignItems: "center",
      paddingTop: 2,
    },
    statusCancelText: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.textSecondary,
    },
    pingToggleButton: {
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.tint,
      backgroundColor: colors.cardBackground,
      alignItems: "center",
      paddingVertical: 9,
      paddingHorizontal: 12,
    },
    pingToggleText: {
      fontSize: 13,
      fontWeight: "700",
      color: colors.tint,
    },
    pingList: {
      borderWidth: 1,
      borderColor: colors.cardBorder,
      borderRadius: 10,
      padding: 10,
      gap: 8,
      backgroundColor: colors.pillBackground,
    },
    pingListHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    pingListTitle: {
      fontSize: 12,
      fontWeight: "700",
      color: colors.textSecondary,
    },
    pingListScroll: {
      maxHeight: 240,
    },
    pingListContent: {
      gap: 8,
    },
    pingListEmpty: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    pingRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBackground,
      paddingHorizontal: 8,
      paddingVertical: 7,
    },
    pingFriendIdentity: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    pingFriendAvatar: {
      width: 26,
      height: 26,
      borderRadius: 13,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.pillBackground,
      alignItems: "center",
      justifyContent: "center",
    },
    pingFriendAvatarText: {
      fontSize: 11,
      fontWeight: "700",
      color: colors.text,
    },
    pingFriendMeta: {
      flex: 1,
      gap: 2,
    },
    pingFriendName: {
      flex: 1,
      fontSize: 13,
      color: colors.text,
    },
    pingFriendStatus: {
      fontSize: 11,
      color: colors.textSecondary,
    },
    pingButton: {
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.tint,
      paddingVertical: 5,
      paddingHorizontal: 11,
      backgroundColor: colors.cardBackground,
    },
    pingButtonDisabled: {
      borderColor: colors.divider,
      backgroundColor: colors.pillBackground,
    },
    pingButtonText: {
      fontSize: 12,
      fontWeight: "700",
      color: colors.tint,
    },
    pingButtonTextDisabled: {
      color: colors.textSecondary,
    },
  });
};
