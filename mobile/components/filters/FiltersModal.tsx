/**
 * Mobile filter UI component: Filters Modal.
 * Comprehensive bottom-sheet filter modal opened by the "Filters" pill.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  LayoutAnimation,
  Modal,
  Platform,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  UIManager,
  View,
} from "react-native";
import { ScrollView as GHScrollView } from "react-native-gesture-handler";
import {
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MeService, type FilterPresetScope } from "shared";
import { useFetchCinemas } from "shared/hooks/useFetchCinemas";
import { useFetchSelectedCinemas } from "shared/hooks/useFetchSelectedCinemas";
import { useSessionCinemaSelections } from "shared/hooks/useSessionCinemaSelections";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import { formatDayPillLabel } from "@/components/filters/day-filter-utils";
import { type SharedTabShowtimeFilter } from "@/components/filters/shared-tab-filters";
import { type PageFilterPresetState } from "@/components/filters/FilterPresetsModal";
import TimeRangeSliderInline from "@/components/filters/TimeRangeSliderInline";
import RuntimeRangeSliderInline from "@/components/filters/RuntimeRangeSliderInline";
import DayFilterModal from "@/components/filters/DayFilterModal";
import CinemaFilterModal from "@/components/filters/CinemaFilterModal";

// LayoutAnimation needs an explicit opt-in on Android (it is on by default on iOS).
if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// Smooth height tween for the cinema expand/collapse "swipe open".
const EXPAND_LAYOUT_ANIMATION = {
  duration: 220,
  create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
  update: { type: LayoutAnimation.Types.easeInEaseOut },
  delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
};

type CombinedStatusOption = {
  label: string;
  filter: SharedTabShowtimeFilter;
  audience: "including-friends" | "only-you" | null;
};

const DAY_PRESETS = [
  { token: "relative:today", label: "Today" },
  { token: "relative:tomorrow", label: "Tomorrow" },
  { token: "relative:day_after_tomorrow", label: "Day after tomorrow" },
] as const;

const STATUS_OPTIONS_SIMPLE: { value: SharedTabShowtimeFilter; label: string }[] = [
  { value: "all", label: "Any" },
  { value: "interested", label: "Interested" },
  { value: "going", label: "Going" },
];

const STATUS_OPTIONS_COMBINED: CombinedStatusOption[] = [
  { label: "Any", filter: "all", audience: null },
  { label: "Interested (You)", filter: "interested", audience: "only-you" },
  { label: "Interested (Friends)", filter: "interested", audience: "including-friends" },
  { label: "Going (You)", filter: "going", audience: "only-you" },
  { label: "Going (Friends)", filter: "going", audience: "including-friends" },
];

type ShowtimeAudience = "including-friends" | "only-you";

export type FiltersModalProps = {
  visible: boolean;
  onClose: () => void;
  scope: FilterPresetScope;
  groupByMovie: boolean;
  setGroupByMovie: (v: boolean) => void;
  showGroupByMovie?: boolean;
  watchlistOnly: boolean;
  setWatchlistOnly: (v: boolean) => void;
  canUseWatchlistFilter?: boolean;
  selectedShowtimeFilter: SharedTabShowtimeFilter;
  setSelectedShowtimeFilter: (v: SharedTabShowtimeFilter) => void;
  showStatusFilter?: boolean;
  selectedShowtimeAudience?: ShowtimeAudience;
  setSelectedShowtimeAudience?: (v: ShowtimeAudience) => void;
  selectedDays: string[];
  setSelectedDays: (v: string[]) => void;
  selectedTimeRanges: string[];
  setSelectedTimeRanges: (v: string[]) => void;
  selectedRuntimeRanges: string[];
  setSelectedRuntimeRanges: (v: string[]) => void;
  currentPresetFilters: PageFilterPresetState;
  resultCount?: number;
};

export default function FiltersModal({
  visible,
  onClose,
  scope,
  groupByMovie,
  setGroupByMovie,
  showGroupByMovie = false,
  watchlistOnly,
  setWatchlistOnly,
  canUseWatchlistFilter = false,
  selectedShowtimeFilter,
  setSelectedShowtimeFilter,
  showStatusFilter = false,
  selectedShowtimeAudience = "including-friends",
  setSelectedShowtimeAudience,
  selectedDays,
  setSelectedDays,
  selectedTimeRanges,
  setSelectedTimeRanges,
  selectedRuntimeRanges,
  setSelectedRuntimeRanges,
  currentPresetFilters,
  resultCount,
}: FiltersModalProps) {
  const colors = useThemeColors();
  const { top: topInset, bottom: bottomInset } = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const queryClient = useQueryClient();
  const bottomSheetModalRef = useRef<BottomSheetModal>(null);
  const scrollViewRef = useRef<any>(null);
  const snapPoints = useMemo(() => ["88%"], []);

  const [dayModalVisible, setDayModalVisible] = useState(false);

  // Drive the gorhom sheet imperatively from the controlled `visible` prop.
  // Rules:
  //  - present() on open (always safe)
  //  - close() (not dismiss()) on programmatic close — keeps content mounted so next open is instant
  //  - never call close()/dismiss() when gorhom already closed the sheet (would corrupt statusRef)
  const hasEverPresentedRef = useRef(false);
  const closedByGorhomRef = useRef(false);

  // contentMounted: false on first open (shows spinner while content renders),
  // then permanently true so subsequent opens show content immediately.
  const [contentMounted, setContentMounted] = useState(false);
  const contentMountedRef = useRef(false);

  const handleSheetChange = useCallback((index: number) => {
    if (index === -1) {
      closedByGorhomRef.current = true;
      onClose();
    }
  }, [onClose]);

  useEffect(() => {
    if (visible) {
      hasEverPresentedRef.current = true;
      closedByGorhomRef.current = false;
      bottomSheetModalRef.current?.present();
      scrollViewRef.current?.scrollTo({ y: 0, animated: false });
      if (!contentMountedRef.current) {
        // Defer heavy content render until after the sheet has mounted with the spinner
        // and the slide-up animation is underway. setTimeout(50) fires in a separate
        // React batch from gorhom's setState({ mount: true }), so the spinner actually
        // renders first. Nested RAFs fire in the same batch and get skipped by React 18.
        setTimeout(() => {
          contentMountedRef.current = true;
          setContentMounted(true);
        }, 50);
      }
    } else if (hasEverPresentedRef.current && !closedByGorhomRef.current) {
      bottomSheetModalRef.current?.close();
    }
  }, [visible]);


  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} opacity={0.45} pressBehavior="close" />
    ),
    []
  );

  const renderHandle = useCallback(
    () => (
      <View style={styles.header}>
        <ThemedText style={styles.headerTitle}>Filters</ThemedText>
        <TouchableOpacity onPress={() => bottomSheetModalRef.current?.close()} hitSlop={8}>
          <MaterialIcons name="close" size={22} color={colors.text} />
        </TouchableOpacity>
      </View>
    ),
    [colors, styles]
  );

  const [cinemasExpanded, setCinemasExpanded] = useState(false);
  // cinemaListReady gates the heavy real cinema list behind a hardcoded skeleton
  // so the caret + open animation can start without waiting on its render.
  const [cinemaListReady, setCinemaListReady] = useState(false);
  const caretRotation = useRef(new Animated.Value(0)).current;
  const caretSpin = useMemo(
    () => caretRotation.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "180deg"] }),
    [caretRotation]
  );

  const toggleCinemasExpanded = useCallback(() => {
    const next = !cinemasExpanded;
    // Rotate the caret on the native thread — starts instantly, never blocked by JS render.
    Animated.timing(caretRotation, {
      toValue: next ? 1 : 0,
      duration: 220,
      useNativeDriver: true,
    }).start();
    // Animate the open/close height change.
    LayoutAnimation.configureNext(EXPAND_LAYOUT_ANIMATION);
    if (next) {
      // Show the skeleton immediately, then defer the heavy real-list render to a
      // later task (separate React batch) so the open animation paints first.
      setCinemaListReady(false);
      setTimeout(() => {
        LayoutAnimation.configureNext(EXPAND_LAYOUT_ANIMATION);
        setCinemaListReady(true);
      }, 0);
    }
    setCinemasExpanded(next);
  }, [cinemasExpanded, caretRotation]);

  const [cinemaModalVisible, setCinemaModalVisible] = useState(false);
  const [cinemaModalPage, setCinemaModalPage] = useState<"selection" | "presets">("presets");
  const [cinemaSaveModalVisible, setCinemaSaveModalVisible] = useState(false);
  const [cinemaSaveName, setCinemaSaveName] = useState("");
  const [cinemaSaveAsFavorite, setCinemaSaveAsFavorite] = useState(false);
  const [cinemaSaveError, setCinemaSaveError] = useState<string | null>(null);
  const [hasMoreCinemaRight, setHasMoreCinemaRight] = useState(false);
  const cinemaScrollContentW = useRef(0);
  const cinemaScrollContainerW = useRef(0);

  const [hasMoreDayRight, setHasMoreDayRight] = useState(false);
  const dayScrollContentW = useRef(0);
  const dayScrollContainerW = useRef(0);

  const { data: allCinemas = [] } = useFetchCinemas();
  const { data: preferredCinemaIds } = useFetchSelectedCinemas();
  const { selections: sessionCinemaIds, setSelections: setSessionCinemaIds } =
    useSessionCinemaSelections();
  const { data: cinemaPresets = [] } = useQuery({
    queryKey: ["cinema-presets"],
    queryFn: () => MeService.getCinemaPresets(),
  });
  const { data: filterPresets = [] } = useQuery({
    queryKey: ["user", "filter_presets", scope],
    queryFn: () => MeService.getFilterPresets({ scope }),
  });

  const effectiveCinemaIds = sessionCinemaIds ?? preferredCinemaIds ?? [];
  const sortedEffectiveIds = useMemo(
    () => Array.from(new Set(effectiveCinemaIds)).sort((a, b) => a - b),
    [effectiveCinemaIds]
  );

  const { cityGroups, ungroupedCinemas } = useMemo(() => {
    const GROUPING_MINIMUM = 3;
    const map = new Map<number, { cityName: string; cinemas: typeof allCinemas }>();
    for (const c of allCinemas) {
      if (!map.has(c.city.id)) map.set(c.city.id, { cityName: c.city.name, cinemas: [] });
      map.get(c.city.id)!.cinemas.push(c);
    }
    const groups: { cityName: string; cinemas: typeof allCinemas }[] = [];
    const ungrouped: typeof allCinemas = [];
    for (const group of map.values()) {
      if (group.cinemas.length >= GROUPING_MINIMUM) groups.push(group);
      else ungrouped.push(...group.cinemas);
    }
    ungrouped.sort((a, b) => a.city.name.localeCompare(b.city.name) || a.name.localeCompare(b.name));
    return { cityGroups: groups, ungroupedCinemas: ungrouped };
  }, [allCinemas]);

  const matchingCinemaPreset = useMemo(
    () => cinemaPresets.some((p) =>
      JSON.stringify(Array.from(new Set(p.cinema_ids)).sort((a, b) => a - b)) === JSON.stringify(sortedEffectiveIds)
    ),
    [cinemaPresets, sortedEffectiveIds]
  );

  const { mutate: saveCinemaPreset, isPending: isSavingCinemaPreset } = useMutation({
    mutationFn: ({ name, isFavorite }: { name: string; isFavorite: boolean }) =>
      MeService.createCinemaPreset({
        requestBody: { name, cinema_ids: sortedEffectiveIds, is_favorite: isFavorite },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cinema-presets"] });
      setCinemaSaveName("");
      setCinemaSaveAsFavorite(false);
      setCinemaSaveError(null);
      setCinemaSaveModalVisible(false);
    },
    onError: () => {
      setCinemaSaveError("Could not save preset. Please try again.");
    },
  });

  const dayLabel = formatDayPillLabel(selectedDays);

  return (
    <>
      <BottomSheetModal
        ref={bottomSheetModalRef}
        snapPoints={snapPoints}
        enablePanDownToClose
        enableDismissOnClose={false}
        animationConfigs={{ duration: 220 }}
        backdropComponent={renderBackdrop}
        handleComponent={renderHandle}
        backgroundStyle={{ backgroundColor: colors.background }}
        topInset={topInset}
        bottomInset={bottomInset}
        onChange={handleSheetChange}
      >
        <BottomSheetScrollView
          ref={scrollViewRef}
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
{!contentMounted ? (
            <View style={{ alignItems: "center", paddingVertical: 60 }}>
              <ActivityIndicator size="large" color={colors.tint} />
            </View>
          ) : (<>

            {/* Group by Movie */}
            {showGroupByMovie && (
              <>
                <SectionLabel label="Group By" colors={colors} />
                <View style={styles.pillRow}>
                  <Pill label="Showtimes" active={!groupByMovie} onPress={() => setGroupByMovie(false)} colors={colors} />
                  <Pill label="Movies" active={groupByMovie} onPress={() => setGroupByMovie(true)} colors={colors} />
                </View>
                <Divider colors={colors} />
              </>
            )}

            {/* Status */}
            {showStatusFilter && (
              <>
                <SectionLabel label="Filter By Status" colors={colors} />
                <View style={styles.pillRow}>
                  {setSelectedShowtimeAudience
                    ? STATUS_OPTIONS_COMBINED.map((opt) => (
                        <Pill
                          key={`${opt.filter}-${opt.audience}`}
                          label={opt.label}
                          active={
                            selectedShowtimeFilter === opt.filter &&
                            (opt.audience === null || selectedShowtimeAudience === opt.audience)
                          }
                          onPress={() => {
                            setSelectedShowtimeFilter(opt.filter);
                            if (opt.audience) setSelectedShowtimeAudience(opt.audience);
                          }}
                          colors={colors}
                        />
                      ))
                    : STATUS_OPTIONS_SIMPLE.map((opt) => (
                        <Pill
                          key={opt.value}
                          label={opt.label}
                          active={selectedShowtimeFilter === opt.value}
                          onPress={() => setSelectedShowtimeFilter(opt.value)}
                          colors={colors}
                        />
                      ))}
                </View>
                <Divider colors={colors} />
              </>
            )}

            {/* Watchlist */}
            {canUseWatchlistFilter && (
              <>
                <SectionLabel label="Watchlist" colors={colors} />
                <View style={styles.pillRow}>
                  <Pill label="All movies" active={!watchlistOnly} onPress={() => setWatchlistOnly(false)} colors={colors} />
                  <Pill label="Watchlisted only" active={watchlistOnly} onPress={() => setWatchlistOnly(true)} colors={colors} />
                </View>
                <Divider colors={colors} />
              </>
            )}

            {/* Cinemas */}
            <SectionLabel label="Cinemas" colors={colors} />
            <View style={styles.cinemaRow}>
              {/* Pinned "N selected" button — mirrors the Filters button treatment */}
              <TouchableOpacity
                style={[styles.pill, styles.cinemaCountPill, cinemasExpanded && styles.pillActive]}
                onPress={toggleCinemasExpanded}
                activeOpacity={0.8}
              >
                <View style={styles.pillContent}>
                  <ThemedText style={cinemasExpanded ? styles.pillTextActive : styles.pillText}>{sortedEffectiveIds.length} selected</ThemedText>
                  <Animated.View style={{ transform: [{ rotate: caretSpin }] }}>
                    <MaterialIcons name="expand-more" size={14} color={cinemasExpanded ? colors.pillActiveText : colors.pillText} />
                  </Animated.View>
                </View>
              </TouchableOpacity>
              <View style={styles.cinemaSeparator} />
              {/* Scrollable presets */}
              <View style={{ flex: 1 }}>
                <GHScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.pillRowScroll}
                  style={{ flex: 1 }}
                  scrollEventThrottle={16}
                  onLayout={(e) => {
                    cinemaScrollContainerW.current = e.nativeEvent.layout.width;
                    setHasMoreCinemaRight(cinemaScrollContentW.current > e.nativeEvent.layout.width + 2);
                  }}
                  onContentSizeChange={(w) => {
                    cinemaScrollContentW.current = w;
                    setHasMoreCinemaRight(w > cinemaScrollContainerW.current + 2);
                  }}
                  onScroll={(e) => {
                    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
                    setHasMoreCinemaRight(contentOffset.x + layoutMeasurement.width < contentSize.width - 2);
                  }}
                >
                  {!matchingCinemaPreset && sortedEffectiveIds.length > 0 && (
                    <TouchableOpacity
                      style={styles.savePresetPill}
                      onPress={() => { setCinemaSaveName(""); setCinemaSaveAsFavorite(false); setCinemaSaveError(null); setCinemaSaveModalVisible(true); }}
                      activeOpacity={0.8}
                    >
                      <MaterialIcons name="save" size={13} color={colors.tint} />
                      <ThemedText style={styles.savePresetPillText}>Save as preset</ThemedText>
                    </TouchableOpacity>
                  )}
                  {cinemaPresets.map((preset) => {
                    const sig = JSON.stringify(Array.from(new Set(preset.cinema_ids)).sort((a, b) => a - b));
                    const isActive = sig === JSON.stringify(sortedEffectiveIds);
                    return (
                      <Pill key={preset.id} label={preset.name} active={isActive} isFavorite={preset.is_favorite} onPress={() => setSessionCinemaIds(Array.from(preset.cinema_ids))} colors={colors} style={{ marginBottom: 0 }} />
                    );
                  })}
                  <Pill label="Manage presets" active={false} onPress={() => { setCinemaModalPage("presets"); setCinemaModalVisible(true); }} colors={colors} style={{ marginBottom: 0 }} />
                </GHScrollView>
                {hasMoreCinemaRight && (
                  <View style={styles.scrollFadeRight} pointerEvents="none">
                    <MaterialIcons name="chevron-right" size={16} color={colors.textSecondary} />
                  </View>
                )}
              </View>
            </View>

            {cinemasExpanded && !cinemaListReady && (
              <CinemaExpandLoader colors={colors} />
            )}

            {cinemasExpanded && cinemaListReady && (
              <View style={styles.cinemaExpand}>
                {/* Global select/deselect — styled as a card to match the city cards */}
                <View style={styles.expandCard}>
                  <View style={styles.expandCardHeader}>
                    <ThemedText style={styles.expandCityTitle}>All cinemas</ThemedText>
                    <View style={styles.expandGlobalRow}>
                      <TouchableOpacity
                        style={styles.expandToggleBtn}
                        onPress={() => setSessionCinemaIds(allCinemas.map((c) => c.id))}
                        activeOpacity={0.8}
                      >
                        <ThemedText style={styles.expandToggleBtnText}>Select all</ThemedText>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.expandToggleBtn}
                        onPress={() => setSessionCinemaIds([])}
                        activeOpacity={0.8}
                      >
                        <ThemedText style={styles.expandToggleBtnText}>Deselect all</ThemedText>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
                {/* Per-city cards */}
                {cityGroups.map(({ cityName, cinemas }) => {
                  const cityIds = cinemas.map((c) => c.id);
                  const cityAllSelected = cityIds.every((id) => effectiveCinemaIds.includes(id));
                  return (
                    <View key={cityName} style={styles.expandCard}>
                      <View style={styles.expandCardHeader}>
                        <ThemedText style={styles.expandCityTitle}>{cityName}</ThemedText>
                        <TouchableOpacity
                          style={styles.expandToggleBtn}
                          onPress={() => {
                            const next = cityAllSelected
                              ? effectiveCinemaIds.filter((id) => !cityIds.includes(id))
                              : Array.from(new Set([...effectiveCinemaIds, ...cityIds]));
                            setSessionCinemaIds(next);
                          }}
                          activeOpacity={0.8}
                        >
                          <ThemedText style={styles.expandToggleBtnText}>
                            {cityAllSelected ? "Deselect all" : "Select all"}
                          </ThemedText>
                        </TouchableOpacity>
                      </View>
                      <View style={styles.expandCinemaList}>
                        {cinemas.map((cinema) => {
                          const selected = effectiveCinemaIds.includes(cinema.id);
                          return (
                            <TouchableOpacity
                              key={cinema.id}
                              style={[styles.expandCinemaRow, selected && styles.expandCinemaRowSelected]}
                              onPress={() => {
                                const next = selected
                                  ? effectiveCinemaIds.filter((id) => id !== cinema.id)
                                  : [...effectiveCinemaIds, cinema.id];
                                setSessionCinemaIds(next);
                              }}
                              activeOpacity={0.8}
                            >
                              <ThemedText style={styles.expandCinemaName} numberOfLines={1}>
                                {cinema.name}
                              </ThemedText>
                              <View style={[styles.expandCheckbox, selected && styles.expandCheckboxSelected]}>
                                {selected ? <MaterialIcons name="check" size={11} color={colors.pillActiveText} /> : null}
                              </View>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </View>
                  );
                })}

                {ungroupedCinemas.length > 0 && (
                  <View style={styles.expandCard}>
                    <View style={styles.expandCardHeader}>
                      <ThemedText style={styles.expandCityTitle}>Other cinemas</ThemedText>
                    </View>
                    <View style={styles.expandCinemaList}>
                      {ungroupedCinemas.map((cinema) => {
                        const selected = effectiveCinemaIds.includes(cinema.id);
                        return (
                          <TouchableOpacity
                            key={cinema.id}
                            style={[styles.expandCinemaRow, selected && styles.expandCinemaRowSelected]}
                            onPress={() => {
                              const next = selected
                                ? effectiveCinemaIds.filter((id) => id !== cinema.id)
                                : [...effectiveCinemaIds, cinema.id];
                              setSessionCinemaIds(next);
                            }}
                            activeOpacity={0.8}
                          >
                            <View>
                              <ThemedText style={styles.expandCinemaName} numberOfLines={1}>{cinema.name}</ThemedText>
                              <ThemedText style={styles.expandCinemaCity} numberOfLines={1}>{cinema.city.name}</ThemedText>
                            </View>
                            <View style={[styles.expandCheckbox, selected && styles.expandCheckboxSelected]}>
                              {selected ? <MaterialIcons name="check" size={11} color={colors.pillActiveText} /> : null}
                            </View>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                )}

              </View>
            )}

            <Divider colors={colors} />

            {/* Days */}
            <SectionLabel label="Days" colors={colors} />
            <View style={styles.cinemaRow}>
              {/* Pinned summary pill — opens full day picker */}
              <TouchableOpacity
                style={[styles.pill, styles.cinemaCountPill, selectedDays.length > 0 && styles.pillActive]}
                onPress={() => setDayModalVisible(true)}
                activeOpacity={0.8}
              >
                <View style={styles.pillContent}>
                  <ThemedText style={selectedDays.length > 0 ? styles.pillTextActive : styles.pillText}>
                    {dayLabel}
                  </ThemedText>
                  <MaterialIcons name="chevron-right" size={14} color={selectedDays.length > 0 ? colors.pillActiveText : colors.pillText} />
                </View>
              </TouchableOpacity>
              <View style={styles.cinemaSeparator} />
              {/* Quick-select presets */}
              <View style={{ flex: 1 }}>
                <GHScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.pillRowScroll}
                  style={{ flex: 1 }}
                  scrollEventThrottle={16}
                  onLayout={(e) => {
                    dayScrollContainerW.current = e.nativeEvent.layout.width;
                    setHasMoreDayRight(dayScrollContentW.current > e.nativeEvent.layout.width + 2);
                  }}
                  onContentSizeChange={(w) => {
                    dayScrollContentW.current = w;
                    setHasMoreDayRight(w > dayScrollContainerW.current + 2);
                  }}
                  onScroll={(e) => {
                    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
                    setHasMoreDayRight(contentOffset.x + layoutMeasurement.width < contentSize.width - 2);
                  }}
                >
                  {DAY_PRESETS.map(({ token, label }) => {
                    const isActive = selectedDays.includes(token);
                    return (
                      <Pill
                        key={token}
                        label={label}
                        active={isActive}
                        onPress={() => setSelectedDays(isActive ? [] : [token])}
                        colors={colors}
                        style={{ marginBottom: 0 }}
                      />
                    );
                  })}
                </GHScrollView>
                {hasMoreDayRight && (
                  <View style={styles.scrollFadeRight} pointerEvents="none">
                    <MaterialIcons name="chevron-right" size={16} color={colors.textSecondary} />
                  </View>
                )}
              </View>
            </View>

            <Divider colors={colors} />

            {/* Time */}
            <SectionLabel label="Time of day" colors={colors} />
            <TimeRangeSliderInline
              selectedTimeRanges={selectedTimeRanges}
              onChange={setSelectedTimeRanges}
            />

            <Divider colors={colors} />

            {/* Runtime */}
            <SectionLabel label="Runtime" colors={colors} />
            <RuntimeRangeSliderInline
              selectedRuntimeRanges={selectedRuntimeRanges}
              onChange={setSelectedRuntimeRanges}
            />

            <TouchableOpacity
              style={styles.viewResultsButton}
              onPress={() => bottomSheetModalRef.current?.close()}
              activeOpacity={0.85}
            >
              {resultCount !== undefined ? (
                <ThemedText style={styles.viewResultsButtonText}>
                  View {resultCount} {groupByMovie ? "Movies" : "Showtimes"}
                </ThemedText>
              ) : (
                <CountSkeleton />
              )}
            </TouchableOpacity>
          </>)}
        </BottomSheetScrollView>
      </BottomSheetModal>
      {/* DayFilterModal is internal so day changes stay pending until FiltersModal closes */}
      <DayFilterModal
        visible={dayModalVisible}
        onClose={() => setDayModalVisible(false)}
        selectedDays={selectedDays}
        onChange={setSelectedDays}
      />
      <CinemaFilterModal
        visible={cinemaModalVisible}
        onClose={() => setCinemaModalVisible(false)}
        initialPage={cinemaModalPage}
      />
      <Modal
        transparent
        statusBarTranslucent
        visible={cinemaSaveModalVisible}
        animationType="fade"
        onRequestClose={() => { if (!isSavingCinemaPreset) setCinemaSaveModalVisible(false); }}
      >
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.dialogBackdrop}>
          <TouchableOpacity
            style={styles.dialogBackdropPressable}
            activeOpacity={1}
            onPress={() => { if (!isSavingCinemaPreset) setCinemaSaveModalVisible(false); }}
          />
          <View style={styles.dialogCard}>
            <View style={styles.dialogHeader}>
              <ThemedText style={styles.dialogTitle}>Save as preset</ThemedText>
              <ThemedText style={styles.dialogSubtitle}>
                Save your current cinema selection to reuse it later.
              </ThemedText>
            </View>
            <TextInput
              value={cinemaSaveName}
              onChangeText={(v) => { setCinemaSaveName(v); if (cinemaSaveError) setCinemaSaveError(null); }}
              placeholder="Cinema preset name"
              placeholderTextColor={colors.textSecondary}
              style={styles.dialogInput}
              maxLength={80}
              autoCapitalize="words"
              autoCorrect={false}
              autoFocus
            />
            <TouchableOpacity
              style={styles.favoriteToggle}
              onPress={() => setCinemaSaveAsFavorite((v) => !v)}
              activeOpacity={0.8}
            >
              <MaterialIcons
                name={cinemaSaveAsFavorite ? "check-box" : "check-box-outline-blank"}
                size={20}
                color={cinemaSaveAsFavorite ? colors.tint : colors.textSecondary}
              />
              <View style={styles.favoriteToggleText}>
                <ThemedText style={styles.favoriteToggleTitle}>Save as default preset</ThemedText>
                <ThemedText style={styles.favoriteToggleSubtitle}>
                  This marks the preset as your favorite.
                </ThemedText>
              </View>
            </TouchableOpacity>
            {cinemaSaveError ? <ThemedText style={styles.dialogErrorText}>{cinemaSaveError}</ThemedText> : null}
            <View style={styles.dialogActions}>
              <TouchableOpacity
                style={[styles.dialogButton, styles.dialogButtonSecondary]}
                onPress={() => setCinemaSaveModalVisible(false)}
                activeOpacity={0.8}
                disabled={isSavingCinemaPreset}
              >
                <ThemedText style={[styles.dialogButtonText, styles.dialogButtonTextSecondary]}>Cancel</ThemedText>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.dialogButton, styles.dialogButtonPrimary, (isSavingCinemaPreset || !cinemaSaveName.trim()) && styles.dialogButtonDisabled]}
                onPress={() => { const name = cinemaSaveName.trim(); if (name) saveCinemaPreset({ name, isFavorite: cinemaSaveAsFavorite }); }}
                activeOpacity={0.8}
                disabled={isSavingCinemaPreset || !cinemaSaveName.trim()}
              >
                <ThemedText style={[styles.dialogButtonText, styles.dialogButtonTextPrimary]}>
                  {isSavingCinemaPreset ? "Saving…" : "Save"}
                </ThemedText>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────


function SectionLabel({ label, colors }: { label: string; colors: ReturnType<typeof useThemeColors> }) {
  return (
    <ThemedText style={{ color: colors.textSecondary, fontSize: 11, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 7 }}>
      {label}
    </ThemedText>
  );
}

function Divider({ colors }: { colors: ReturnType<typeof useThemeColors> }) {
  return <View style={{ height: 1, backgroundColor: colors.divider, marginVertical: 12 }} />;
}

function CountSkeleton() {
  const opacity = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.8, duration: 500, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 500, useNativeDriver: true }),
      ])
    ).start();
  }, [opacity]);
  return (
    <Animated.View style={{ opacity, height: 20, width: 140, borderRadius: 6, backgroundColor: "rgba(255,255,255,0.5)" }} />
  );
}

function CinemaExpandLoader({ colors }: { colors: ReturnType<typeof useThemeColors> }) {
  return (
    <View style={{ alignItems: "center", paddingVertical: 20 }}>
      <ActivityIndicator size="small" color={colors.tint} />
    </View>
  );
}

function Pill({ label, active, onPress, colors, style, isFavorite }: { label: string; active: boolean; onPress: () => void; colors: ReturnType<typeof useThemeColors>; style?: object; isFavorite?: boolean }) {
  return (
    <TouchableOpacity
      style={[{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: active ? colors.pillActiveBackground : colors.pillBackground, marginRight: 7, marginBottom: 7, flexDirection: "row", alignItems: "center", gap: 4 }, style]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      {isFavorite && <MaterialIcons name="star" size={11} color={active ? colors.pillActiveText : colors.yellow.secondary} />}
      <ThemedText style={{ fontSize: 13, fontWeight: "500", color: active ? colors.pillActiveText : colors.pillText }}>
        {label}
      </ThemedText>
    </TouchableOpacity>
  );
}

const createStyles = (colors: ReturnType<typeof useThemeColors>) =>
  StyleSheet.create({
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 20,
      paddingTop: 16,
      paddingBottom: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    headerTitle: { fontSize: 17, fontWeight: "700", flex: 1 },
    scroll: { flex: 1 },
    scrollContent: { paddingHorizontal: 20, paddingTop: 14 },

    pillRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
    pillRowScroll: { gap: 8, alignItems: "center" },
    scrollFadeRight: { position: "absolute", right: 0, top: 0, bottom: 0, justifyContent: "center", paddingLeft: 4, backgroundColor: colors.background },
    cinemaRow: { flexDirection: "row", alignItems: "center" },
    cinemaCountPill: { flexShrink: 0, marginBottom: 0 },
    cinemaSeparator: { width: 1, height: 20, backgroundColor: colors.divider, marginHorizontal: 10, flexShrink: 0 },
    pillContent: { flexDirection: "row", alignItems: "center", gap: 5 },
    pill: { paddingHorizontal: 13, paddingVertical: 7, borderRadius: 18, backgroundColor: colors.pillBackground, marginRight: 8, marginBottom: 8 },
    pillActive: { backgroundColor: colors.pillActiveBackground },
    pillWithIcon: { flexDirection: "row", alignItems: "center", gap: 5 },
    pillText: { fontSize: 13, fontWeight: "500", color: colors.pillText },
    pillTextActive: { fontSize: 13, fontWeight: "500", color: colors.pillActiveText },
    cinemaExpand: { marginTop: 8, gap: 8 },
    expandCard: { borderRadius: 12, borderWidth: 1, borderColor: colors.divider, backgroundColor: colors.cardBackground, padding: 12 },
    expandCardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    expandCardTitle: { fontSize: 15, fontWeight: "700" },
    expandCardMeta: { fontSize: 12, color: colors.textSecondary },
    expandCityTitle: { fontSize: 14, fontWeight: "700" },
    expandToggleBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: colors.divider, backgroundColor: colors.pillBackground },
    expandToggleBtnText: { fontSize: 12, fontWeight: "600", color: colors.textSecondary },
    expandCinemaList: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
    expandCinemaRow: { flexDirection: "row", alignItems: "center", columnGap: 6, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: colors.divider, backgroundColor: colors.cardBackground, alignSelf: "flex-start" },
    expandCinemaRowSelected: { backgroundColor: colors.pillBackground },
    expandCinemaName: { fontSize: 12, fontWeight: "600" },
    expandCinemaCity: { fontSize: 10, color: colors.textSecondary },
    expandCheckbox: { width: 13, height: 13, borderRadius: 6.5, borderWidth: 1.2, borderColor: colors.divider, backgroundColor: "transparent", alignItems: "center", justifyContent: "center" },
    expandCheckboxSelected: { borderColor: colors.tint, backgroundColor: colors.tint },
    expandGlobalRow: { flexDirection: "row", gap: 8 },
    savePresetPill: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18, backgroundColor: colors.pillBackground },
    savePresetPillActive: { backgroundColor: colors.pillActiveBackground },
    savePresetPillText: { fontSize: 13, fontWeight: "400", color: colors.tint },
    savePresetPillTextActive: { color: colors.pillActiveText },

    textLink: { fontSize: 13, color: colors.tint, fontWeight: "500", paddingVertical: 4 },
    openRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 8 },
    openRowLabel: { fontSize: 14, color: colors.textSecondary },
    saveRow: { flexDirection: "row", gap: 10, alignItems: "center" },
    input: { flex: 1, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14 },
    saveBtn: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10, minWidth: 64, alignItems: "center" },
    saveBtnDisabled: { opacity: 0.5 },
    saveBtnText: { color: "#fff", fontWeight: "600", fontSize: 14 },
    viewResultsButton: {
      marginTop: 40,
      marginBottom: 40,
      backgroundColor: colors.tint,
      paddingHorizontal: 20,
      paddingVertical: 16,
      borderRadius: 14,
      alignItems: "center",
    },
    viewResultsButtonText: { color: "#000", fontWeight: "700", fontSize: 15, lineHeight: 20 },

    dialogBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.28)", justifyContent: "flex-end", paddingHorizontal: 20, paddingBottom: 16 },
    dialogBackdropPressable: { ...StyleSheet.absoluteFillObject },
    dialogCard: { borderRadius: 16, borderWidth: 1, borderColor: colors.cardBorder, backgroundColor: colors.background, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 12, gap: 11, shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 9 },
    dialogHeader: { gap: 3 },
    dialogTitle: { fontSize: 16, fontWeight: "700", color: colors.text },
    dialogSubtitle: { fontSize: 12, color: colors.textSecondary, lineHeight: 18 },
    dialogInput: { borderWidth: 1, borderColor: colors.divider, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: colors.cardBackground, color: colors.text, fontSize: 14, fontWeight: "500" },
    favoriteToggle: { flexDirection: "row", alignItems: "flex-start", gap: 10, borderRadius: 12, borderWidth: 1, borderColor: colors.divider, backgroundColor: colors.pillBackground, paddingHorizontal: 10, paddingVertical: 10 },
    favoriteToggleText: { flex: 1, gap: 2 },
    favoriteToggleTitle: { fontSize: 13, fontWeight: "700", color: colors.text },
    favoriteToggleSubtitle: { fontSize: 11, color: colors.textSecondary, lineHeight: 16 },
    dialogErrorText: { fontSize: 12, color: colors.red.secondary },
    dialogActions: { flexDirection: "row", gap: 8 },
    dialogButton: { flex: 1, minHeight: 38, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
    dialogButtonPrimary: { backgroundColor: colors.tint, borderColor: colors.tint },
    dialogButtonSecondary: { backgroundColor: colors.cardBackground, borderColor: colors.divider },
    dialogButtonDisabled: { opacity: 0.5 },
    dialogButtonText: { fontSize: 13, fontWeight: "700" },
    dialogButtonTextPrimary: { color: colors.pillActiveText },
    dialogButtonTextSecondary: { color: colors.textSecondary },
  });
