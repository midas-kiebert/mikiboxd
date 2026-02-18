/**
 * Expo Router screen/module for movie / [id]. It controls navigation and screen-level state for this route.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  TouchableOpacity,
  View,
  Linking,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { BlurView } from "expo-blur";
import type { GoingStatus, MovieLoggedIn, ShowtimeInMovieLoggedIn } from "shared";
import { MoviesService, ShowtimesService } from "shared";
import { useFetchMovieShowtimes } from "shared/hooks/useFetchMovieShowtimes";
import { useFetchSelectedCinemas } from "shared/hooks/useFetchSelectedCinemas";
import { useSessionCinemaSelections } from "shared/hooks/useSessionCinemaSelections";

import { ThemedText } from "@/components/themed-text";
import ShowtimeRow from "@/components/showtimes/ShowtimeRow";
import FilterPills from "@/components/filters/FilterPills";
import CinemaFilterModal from "@/components/filters/CinemaFilterModal";
import DayFilterModal from "@/components/filters/DayFilterModal";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useThemeColors } from "@/hooks/use-theme-color";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { isCinemaSelectionDifferentFromPreferred } from "@/utils/cinema-selection";

const SHOWTIMES_PAGE_SIZE = 20;
// Filter pill definitions rendered in the top filter row.
const BASE_FILTERS = [
  { id: "showtime-filter", label: "All Showtimes" },
  { id: "cinemas", label: "Cinemas" },
  { id: "days", label: "Days" },
];

type ShowtimeFilter = "all" | "going" | "interested";

export default function MoviePage() {
  // Read flow: local state and data hooks first, then handlers, then the JSX screen.
  const colorScheme = useColorScheme();
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
  const modalProgress = useRef(new Animated.Value(0)).current;
  // Controls visibility of the cinema-filter modal.
  const [cinemaModalVisible, setCinemaModalVisible] = useState(false);
  // Controls visibility of the day-filter modal.
  const [dayModalVisible, setDayModalVisible] = useState(false);
  // Tracks selected day values used by date filtering.
  const [selectedDays, setSelectedDays] = useState<string[]>([]);

  // Convert route param to numeric movie ID for API calls/query keys.
  const movieId = useMemo(() => Number(id), [id]);
  // Keep one snapshot timestamp so list pages stay consistent while scrolling.
  const snapshotTime = useMemo(
    () => DateTime.now().setZone("Europe/Amsterdam").toFormat("yyyy-MM-dd'T'HH:mm:ss"),
    []
  );
  const { selections: sessionCinemaIds } = useSessionCinemaSelections();
  const { data: preferredCinemaIds } = useFetchSelectedCinemas();
  useEffect(() => {
    if (!selectedShowtime) {
      modalProgress.setValue(0);
      return;
    }
    modalProgress.setValue(0);
    Animated.timing(modalProgress, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [modalProgress, selectedShowtime]);

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
      days: selectedDays.length > 0 ? selectedDays : undefined,
      selectedStatuses,
    };
  }, [selectedDays, selectedFilter, sessionCinemaIds]);

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
  const updateShowtimeInCaches = (showtimeId: number, going: GoingStatus) => {
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
              showtime.id === showtimeId ? { ...showtime, going } : showtime
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
          showtime.id === showtimeId ? { ...showtime, going } : showtime
        ),
      };
    });
  };

  const { mutate: updateShowtimeSelection, isPending: isUpdatingShowtimeSelection } = useMutation({
    mutationFn: ({ showtimeId, going }: { showtimeId: number; going: GoingStatus }) =>
      ShowtimesService.updateShowtimeSelection({
        showtimeId,
        requestBody: {
          going_status: going,
        },
      }),
    onMutate: async ({ showtimeId, going }) => {
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

      // Optimistic update for immediate UI feedback.
      updateShowtimeInCaches(showtimeId, going);
      setSelectedShowtime(null);

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
      updateShowtimeInCaches(updatedShowtime.id, updatedShowtime.going);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["movie", movieId, "showtimes"] });
      queryClient.invalidateQueries({ queryKey: ["movie", movieId] });
      queryClient.invalidateQueries({ queryKey: ["showtimes"] });
      queryClient.invalidateQueries({ queryKey: ["movies"] });
    },
  });

  // Submit the selected going/interested/not-going status.
  const handleShowtimeStatusUpdate = (going: GoingStatus) => {
    if (!selectedShowtime || isUpdatingShowtimeSelection) return;
    updateShowtimeSelection({ showtimeId: selectedShowtime.id, going });
  };
  // Open the selected showtime ticket URL in the system browser.
  const handleOpenTicketLink = async () => {
    const ticketLink = selectedShowtime?.ticket_link;
    if (!ticketLink) return;
    const canOpen = await Linking.canOpenURL(ticketLink);
    if (canOpen) {
      await Linking.openURL(ticketLink);
    }
  };
  const isGoingSelected = selectedShowtime?.going === "GOING";
  const isInterestedSelected = selectedShowtime?.going === "INTERESTED";
  const isNotGoingSelected = selectedShowtime?.going === "NOT_GOING";
  const statusModalBackdropAnimatedStyle = {
    opacity: modalProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 1],
    }),
  };
  const statusModalCardAnimatedStyle = {
    opacity: modalProgress,
    transform: [
      {
        translateY: modalProgress.interpolate({
          inputRange: [0, 1],
          outputRange: [18, 0],
        }),
      },
    ],
  };

  // Handle filter pill presses and update active filter state.
  const handleSelectFilter = (filterId: string) => {
    if (filterId === "showtime-filter") {
      // Tap cycles all -> interested -> going -> all for quick triaging.
      setSelectedFilter((prev) =>
        prev === "all" ? "interested" : prev === "interested" ? "going" : "all"
      );
      return;
    }
    if (filterId === "cinemas") {
      setCinemaModalVisible(true);
      return;
    }
    if (filterId === "days") {
      setDayModalVisible(true);
      return;
    }
  };

  // Build the filter payload from current UI selections.
  const pillFilters = useMemo(() => {
    return BASE_FILTERS.map((filter) => {
      if (filter.id === "showtime-filter") {
        const label =
          selectedFilter === "all"
            ? "All Showtimes"
            : selectedFilter === "going"
              ? "Going"
              : "Interested";
        return { ...filter, label };
      }
      if (filter.id === "days" && selectedDays.length > 0) {
        return { ...filter, label: `Days (${selectedDays.length})` };
      }
      return filter;
    });
  }, [selectedDays.length, selectedFilter]);

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
    if (isCinemaFilterActive) {
      active.push("cinemas");
    }
    return active;
  }, [selectedFilter, selectedDays.length, isCinemaFilterActive]);

  // Render/output using the state and derived values prepared above.
  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <Stack.Screen options={{ headerShown: false }} />
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
      <Modal
        transparent
        visible={!!selectedShowtime}
        animationType="none"
        onRequestClose={() => {
          if (!isUpdatingShowtimeSelection) {
            setSelectedShowtime(null);
          }
        }}
      >
        <Animated.View style={[styles.statusModalBackdrop, statusModalBackdropAnimatedStyle]}>
          <BlurView
            style={styles.statusModalBlur}
            intensity={4}
            tint={colorScheme === "dark" ? "dark" : "light"}
            experimentalBlurMethod="dimezisBlurView"
          />
          <View style={styles.statusModalTint} />
          <Pressable
            style={styles.statusModalDismissArea}
            onPress={() => {
              if (!isUpdatingShowtimeSelection) {
                setSelectedShowtime(null);
              }
            }}
          />
          <Animated.View style={[styles.statusModalCard, statusModalCardAnimatedStyle]}>
            <ThemedText style={styles.statusModalTitle}>Update your status</ThemedText>
            {selectedShowtime ? (
              <ThemedText style={styles.statusModalSubtitle}>
                {DateTime.fromISO(selectedShowtime.datetime).toFormat("ccc, LLL d, HH:mm")} •{" "}
                {selectedShowtime.cinema.name}
              </ThemedText>
            ) : null}
            <TouchableOpacity
              style={[
                styles.ticketButton,
                !selectedShowtime?.ticket_link && styles.ticketButtonDisabled,
              ]}
              disabled={!selectedShowtime?.ticket_link}
              onPress={handleOpenTicketLink}
              activeOpacity={0.8}
            >
              <ThemedText
                style={[
                  styles.ticketButtonText,
                  !selectedShowtime?.ticket_link && styles.ticketButtonTextDisabled,
                ]}
              >
                {selectedShowtime?.ticket_link ? "Open Ticket Link" : "No ticket link available"}
              </ThemedText>
            </TouchableOpacity>
            <View style={styles.statusButtons}>
              <TouchableOpacity
                style={[
                  styles.statusButton,
                  styles.statusButtonGoing,
                  isGoingSelected && styles.statusButtonActive,
                ]}
                disabled={isUpdatingShowtimeSelection}
                onPress={() => handleShowtimeStatusUpdate("GOING")}
                activeOpacity={0.8}
              >
                <ThemedText
                  style={[styles.statusButtonText, isGoingSelected && styles.statusButtonTextActive]}
                >
                  I'm Going
                </ThemedText>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.statusButton,
                  styles.statusButtonInterested,
                  isInterestedSelected && styles.statusButtonActive,
                ]}
                disabled={isUpdatingShowtimeSelection}
                onPress={() => handleShowtimeStatusUpdate("INTERESTED")}
                activeOpacity={0.8}
              >
                <ThemedText
                  style={[
                    styles.statusButtonText,
                    isInterestedSelected && styles.statusButtonTextActive,
                  ]}
                >
                  I'm Interested
                </ThemedText>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.statusButton,
                  styles.statusButtonNotGoing,
                  isNotGoingSelected && styles.statusButtonActive,
                ]}
                disabled={isUpdatingShowtimeSelection}
                onPress={() => handleShowtimeStatusUpdate("NOT_GOING")}
                activeOpacity={0.8}
              >
                <ThemedText
                  style={[
                    styles.statusButtonText,
                    isNotGoingSelected && styles.statusButtonTextActive,
                  ]}
                >
                  I'm Not Going
                </ThemedText>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={styles.statusCancelButton}
              disabled={isUpdatingShowtimeSelection}
              onPress={() => setSelectedShowtime(null)}
              activeOpacity={0.8}
            >
              <ThemedText style={styles.statusCancelText}>
                {isUpdatingShowtimeSelection ? "Updating..." : "Cancel"}
              </ThemedText>
            </TouchableOpacity>
          </Animated.View>
        </Animated.View>
      </Modal>
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
                  <ShowtimeRow showtime={item} showFriends />
                </View>
              </TouchableOpacity>
            )}
            contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 16) }]}
            onEndReached={handleEndReached}
            onEndReachedThreshold={0.4}
            ListHeaderComponent={
              <View style={styles.headerSection}>
                <View style={styles.header}>
                  <Image source={{ uri: movie.poster_link ?? undefined }} style={styles.poster} />
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

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
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
    showtimeCardGlowGoing: {
      shadowColor: colors.green.secondary,
      shadowOpacity: 0.6,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
      elevation: 8,
    },
    showtimeCardGlowInterested: {
      shadowColor: colors.orange.secondary,
      shadowOpacity: 0.6,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
      elevation: 8,
    },
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
  });
