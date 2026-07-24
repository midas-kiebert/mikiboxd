/**
 * Mobile filter UI component: Filters Modal.
 * Comprehensive bottom-sheet filter modal opened by the "Filters" pill.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import { ScrollView as GHScrollView } from "react-native-gesture-handler";
import { BottomSheetScrollView } from "@gorhom/bottom-sheet";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { MeService } from "shared";
import type { Language } from "shared/client";
import { useFetchCinemas } from "shared/hooks/useFetchCinemas";
import { useFetchSelectedCinemas } from "shared/hooks/useFetchSelectedCinemas";
import { useSessionCinemaSelections } from "shared/hooks/useSessionCinemaSelections";

import { ThemedText } from "@/components/themed-text";
import { Skeleton } from "@/components/ui/Skeleton";
import { useThemeColors } from "@/hooks/use-theme-color";
import { useOptimisticValue } from "@/hooks/useOptimisticValue";
import { formatDayPillLabel } from "@/components/filters/day-filter-utils";
import { type SharedTabShowtimeFilter } from "@/components/filters/shared-tab-filters";
import { type PageFilterPresetState } from "@/components/filters/filter-preset-utils";
import { isCinemaSelectionDifferentFromPreferred } from "@/utils/cinema-selection";
import SavePresetDialog from "@/components/filters/SavePresetDialog";
import ManagePresetsModal from "@/components/filters/ManagePresetsModal";
import SavedPresetChips from "@/components/filters/SavedPresetChips";
import { triggerSelectionHaptic } from "@/utils/long-press";
import { applyDisplayPreset, type DisplayPreset } from "@/components/filters/saved-presets";
import TimeRangeSliderInline from "@/components/filters/TimeRangeSliderInline";
import RuntimeRangeSliderInline from "@/components/filters/RuntimeRangeSliderInline";
import DayFilterModal from "@/components/filters/DayFilterModal";
import FilterMoviesSection from "@/components/filters/FilterMoviesSection";
import AppBottomSheet from "@/components/sheets/AppBottomSheet";
import { useFiltersModal } from "@/components/filters/FiltersModalProvider";
import useTrackEvent from "shared/hooks/useTrackEvent";

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

const LANGUAGE_OPTIONS: { value: Language; label: string }[] = [
  { value: "en", label: "English only" },
];

export type FiltersModalProps = {
  visible: boolean;
  onClose: () => void;
  groupByMovie: boolean;
  setGroupByMovie: (v: boolean) => void;
  showGroupByMovie?: boolean;
  showPresets?: boolean;
  watchlistOnly: boolean;
  setWatchlistOnly: (v: boolean) => void;
  hideWatched: boolean;
  setHideWatched: (v: boolean) => void;
  canUseWatchlistFilter?: boolean;
  selectedShowtimeFilter: SharedTabShowtimeFilter;
  setSelectedShowtimeFilter: (v: SharedTabShowtimeFilter) => void;
  showStatusFilter?: boolean;
  showCinemas?: boolean;
  /** Override the cinema modal opener (for pages rendered outside FiltersModalProvider). */
  onOpenCinemaModal?: () => void;
  showRuntime?: boolean;
  selectedDays: string[];
  setSelectedDays: (v: string[]) => void;
  selectedTimeRanges: string[];
  setSelectedTimeRanges: (v: string[]) => void;
  selectedRuntimeRanges: string[];
  setSelectedRuntimeRanges: (v: string[]) => void;
  selectedListIds?: string[];
  setSelectedListIds?: (v: string[]) => void;
  excludeListIds?: string[];
  setExcludeListIds?: (v: string[]) => void;
  selectedLanguages?: Language[];
  setSelectedLanguages?: (v: Language[]) => void;
  watchlistExclude?: boolean;
  setWatchlistExclude?: (v: boolean) => void;
  watchedOnly?: boolean;
  setWatchedOnly?: (v: boolean) => void;
  showLists?: boolean;
  resultCount?: number;
};

export default function FiltersModal({
  visible,
  onClose,
  groupByMovie,
  setGroupByMovie,
  showGroupByMovie = false,
  showPresets = false,
  watchlistOnly,
  setWatchlistOnly,
  hideWatched,
  setHideWatched,
  canUseWatchlistFilter = false,
  selectedShowtimeFilter,
  setSelectedShowtimeFilter,
  showStatusFilter = false,
  showCinemas = true,
  onOpenCinemaModal,
  showRuntime = true,
  selectedDays,
  setSelectedDays,
  selectedTimeRanges,
  setSelectedTimeRanges,
  selectedRuntimeRanges,
  setSelectedRuntimeRanges,
  selectedListIds = [],
  setSelectedListIds = () => {},
  excludeListIds = [],
  setExcludeListIds = () => {},
  selectedLanguages = [],
  setSelectedLanguages = () => {},
  watchlistExclude = false,
  setWatchlistExclude = () => {},
  watchedOnly = false,
  setWatchedOnly = () => {},
  showLists = false,
  resultCount,
}: FiltersModalProps) {
  const colors = useThemeColors();
  const { bottom: bottomInset } = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const queryClient = useQueryClient();
  const scrollViewRef = useRef<any>(null);
  const { openCinemaModal: providerOpenCinemaModal } = useFiltersModal();
  const openCinemaModal = onOpenCinemaModal ?? providerOpenCinemaModal;
  const [dayModalVisible, setDayModalVisible] = useState(false);
  const { trackEvent } = useTrackEvent();
  // Filters apply live as the user taps pills, so any way of dismissing this
  // sheet — the "View results" button, swipe-down, or backdrop tap — commits
  // the current filter state. Track it here, not just on the button, so the
  // swipe/backdrop paths (handled by AppBottomSheet's onClose) aren't missed.
  const handleClose = useCallback(() => {
    trackEvent("filter_applied");
    onClose();
  }, [trackEvent, onClose]);

  // contentMounted: false on first open (shows spinner while content renders),
  // then permanently true so subsequent opens show content immediately.
  const [contentMounted, setContentMounted] = useState(false);
  const contentMountedRef = useRef(false);

  useEffect(() => {
    if (!visible) return;
    scrollViewRef.current?.scrollTo({ y: 0, animated: false });
    if (!contentMountedRef.current) {
      // Defer heavy content render until after the sheet has mounted with the spinner
      // and the slide-up animation is underway. setTimeout(50) fires in a separate
      // React batch so the spinner actually renders first.
      setTimeout(() => {
        contentMountedRef.current = true;
        setContentMounted(true);
      }, 50);
    }
  }, [visible]);

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

  const sortedEffectiveIds = useMemo(() => {
    const effectiveCinemaIds = sessionCinemaIds ?? preferredCinemaIds ?? [];
    return Array.from(new Set(effectiveCinemaIds)).sort((a, b) => a - b);
  }, [sessionCinemaIds, preferredCinemaIds]);


  const dayLabel = formatDayPillLabel(selectedDays);

  // ─── Presets (apply + save) ──────────────────────────────────────────────────
  const [savePresetVisible, setSavePresetVisible] = useState(false);
  const [managePresetsVisible, setManagePresetsVisible] = useState(false);

  const cinemaActive = useMemo(
    () =>
      isCinemaSelectionDifferentFromPreferred({
        sessionCinemaIds: sessionCinemaIds ?? undefined,
        preferredCinemaIds,
      }),
    [sessionCinemaIds, preferredCinemaIds]
  );

  const cinemaLabel = useMemo(() => {
    if (allCinemas.length > 0 && sortedEffectiveIds.length === allCinemas.length) {
      return "All cinemas";
    }
    const signature = JSON.stringify(sortedEffectiveIds);
    const preset = cinemaPresets.find(
      (p) =>
        JSON.stringify(Array.from(new Set(p.cinema_ids)).sort((a, b) => a - b)) ===
        signature
    );
    return preset?.name ?? `${sortedEffectiveIds.length} cinemas`;
  }, [allCinemas, cinemaPresets, sortedEffectiveIds]);

  const currentFilters = useMemo<PageFilterPresetState>(
    () => ({
      selected_showtime_filter: selectedShowtimeFilter,
      showtime_audience: "including-friends",
      watchlist_only: watchlistOnly,
      watchlist_exclude: watchlistExclude,
      hide_watched: hideWatched,
      watched_only: watchedOnly,
      selected_list_ids: selectedListIds.length > 0 ? selectedListIds : null,
      exclude_list_ids: excludeListIds.length > 0 ? excludeListIds : null,
      days: selectedDays.length > 0 ? selectedDays : null,
      time_ranges: selectedTimeRanges.length > 0 ? selectedTimeRanges : null,
      runtime_ranges: selectedRuntimeRanges.length > 0 ? selectedRuntimeRanges : null,
      group_by_movie: groupByMovie,
      selected_languages: selectedLanguages.length > 0 ? selectedLanguages : null,
    }),
    [
      selectedShowtimeFilter,
      watchlistOnly,
      watchlistExclude,
      hideWatched,
      watchedOnly,
      selectedListIds,
      excludeListIds,
      selectedDays,
      selectedTimeRanges,
      selectedRuntimeRanges,
      groupByMovie,
      selectedLanguages,
    ]
  );

  const handleApplyPreset = useCallback(
    (preset: DisplayPreset) => {
      applyDisplayPreset(preset, {
        hasLetterboxdUsername: canUseWatchlistFilter,
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
    },
    [
      canUseWatchlistFilter,
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
    ]
  );

  // Pill toggles below paint optimistically and defer the real (potentially
  // expensive) state update by one frame — see useOptimisticValue.
  const { value: displayGroupByMovie, change: changeGroupByMovie } = useOptimisticValue(
    groupByMovie,
    setGroupByMovie
  );
  const { value: displayShowtimeFilter, change: changeShowtimeFilter } = useOptimisticValue(
    selectedShowtimeFilter,
    setSelectedShowtimeFilter
  );
  const englishOnly = selectedLanguages.includes("en");
  const { value: displayEnglishOnly, change: changeEnglishOnly } = useOptimisticValue(
    englishOnly,
    useCallback((next: boolean) => setSelectedLanguages(next ? ["en"] : []), [setSelectedLanguages])
  );
  const { value: displayWatchlistOnlySimple, change: changeWatchlistOnlySimple } =
    useOptimisticValue(watchlistOnly, setWatchlistOnly);
  const { value: displayHideWatchedSimple, change: changeHideWatchedSimple } =
    useOptimisticValue(hideWatched, setHideWatched);

  return (
    <>
      <AppBottomSheet visible={visible} onClose={handleClose} title="Filters">
        {/* @gorhom/portal (used by the bottom sheet) does not forward React
            context, so re-provide the QueryClient for hooks rendered inside. */}
        <QueryClientProvider client={queryClient}>
        <BottomSheetScrollView
          ref={scrollViewRef}
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomInset }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
{!contentMounted ? (
            <View style={{ alignItems: "center", paddingVertical: 60 }}>
              <ActivityIndicator size="large" color={colors.tint} />
            </View>
          ) : (<>

            {/* Cinemas */}
            {showCinemas && (
              <>
                <SectionLabel label="Cinemas" colors={colors} />
                {cinemaPresets.length > 0 && (
                  <View style={styles.cinemaPresetGrid}>
                    {cinemaPresets.map((preset) => {
                      const presetSig = JSON.stringify(Array.from(new Set(preset.cinema_ids)).sort((a, b) => a - b));
                      const isActive = presetSig === JSON.stringify(sortedEffectiveIds);
                      const n = new Set(preset.cinema_ids).size;
                      return (
                        <TouchableOpacity
                          key={preset.id}
                          style={[styles.cinemaPresetCard, isActive && styles.cinemaPresetCardActive]}
                          onPress={() => { triggerSelectionHaptic(); setSessionCinemaIds(Array.from(preset.cinema_ids)); }}
                          activeOpacity={0.75}
                        >
                          <View style={styles.cinemaPresetCardRow}>
                            <ThemedText
                              style={[styles.cinemaPresetName, isActive && styles.cinemaPresetNameActive]}
                              numberOfLines={2}
                            >
                              {preset.name}
                            </ThemedText>
                            {preset.is_favorite && (
                              <MaterialIcons
                                name="star"
                                size={13}
                                color={isActive ? colors.pillActiveText : colors.yellow.secondary}
                              />
                            )}
                          </View>
                          <ThemedText style={[styles.cinemaPresetDesc, isActive && styles.cinemaPresetDescActive]}>
                            {n} cinema{n === 1 ? "" : "s"}
                          </ThemedText>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
                <TouchableOpacity style={styles.cinemaOpenRow} onPress={() => { triggerSelectionHaptic(); openCinemaModal(); }} activeOpacity={0.8}>
                  <View style={styles.cinemaOpenIcon}>
                    <MaterialIcons name="movie" size={17} color={colors.tint} />
                  </View>
                  <View style={styles.cinemaOpenTextBlock}>
                    <ThemedText style={styles.cinemaOpenTitle}>Select cinemas</ThemedText>
                    <ThemedText style={styles.cinemaOpenSubtitle} numberOfLines={1}>{cinemaLabel}</ThemedText>
                  </View>
                  <MaterialIcons name="chevron-right" size={18} color={colors.textSecondary} />
                </TouchableOpacity>
                <Divider colors={colors} />
              </>
            )}

            {/* Group by Movie */}
            {showGroupByMovie && (
              <>
                <SectionLabel label="Group By" colors={colors} />
                <View style={styles.pillRow}>
                  <Pill label="Showtimes" active={!displayGroupByMovie} onPress={() => changeGroupByMovie(false)} colors={colors} />
                  <Pill label="Movies" active={displayGroupByMovie} onPress={() => changeGroupByMovie(true)} colors={colors} />
                </View>
                <Divider colors={colors} />
              </>
            )}

            {/* Status */}
            {showStatusFilter && (
              <>
                <SectionLabel label="Filter By Status" colors={colors} />
                <View style={styles.pillRow}>
                  {STATUS_OPTIONS_SIMPLE.map((opt) => (
                    <Pill
                      key={opt.value}
                      label={opt.label}
                      active={displayShowtimeFilter === opt.value}
                      onPress={() => changeShowtimeFilter(opt.value)}
                      colors={colors}
                    />
                  ))}
                </View>
                <Divider colors={colors} />
              </>
            )}

            {/* Language */}
            <SectionLabel label="Language" colors={colors} />
            <View style={styles.pillRow}>
              {LANGUAGE_OPTIONS.map((opt) => (
                <Pill
                  key={opt.value}
                  label={opt.label}
                  active={displayEnglishOnly}
                  onPress={() => changeEnglishOnly(!displayEnglishOnly)}
                  colors={colors}
                />
              ))}
            </View>
            <Divider colors={colors} />

            {/* Filter movies (watchlist / watched / Letterboxd lists) */}
            {showLists ? (
              <>
                <FilterMoviesSection
                  colors={colors}
                  canUseWatchlistFilter={canUseWatchlistFilter}
                  watchlistOnly={watchlistOnly}
                  setWatchlistOnly={setWatchlistOnly}
                  watchlistExclude={watchlistExclude}
                  setWatchlistExclude={setWatchlistExclude}
                  hideWatched={hideWatched}
                  setHideWatched={setHideWatched}
                  watchedOnly={watchedOnly}
                  setWatchedOnly={setWatchedOnly}
                  selectedListIds={selectedListIds}
                  setSelectedListIds={setSelectedListIds}
                  excludeListIds={excludeListIds}
                  setExcludeListIds={setExcludeListIds}
                />
                <Divider colors={colors} />
              </>
            ) : (
              canUseWatchlistFilter && (
                <>
                  <SectionLabel label="Watchlist" colors={colors} />
                  <View style={styles.pillRow}>
                    <Pill label="All movies" active={!displayWatchlistOnlySimple} onPress={() => changeWatchlistOnlySimple(false)} colors={colors} />
                    <Pill label="Watchlisted only" active={displayWatchlistOnlySimple} onPress={() => changeWatchlistOnlySimple(true)} colors={colors} />
                  </View>
                  <View style={styles.pillRow}>
                    <Pill label="Hide watched" active={displayHideWatchedSimple} onPress={() => changeHideWatchedSimple(!displayHideWatchedSimple)} colors={colors} />
                  </View>
                  <Divider colors={colors} />
                </>
              )
            )}

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

            {showRuntime && (
              <>
                <Divider colors={colors} />
                <SectionLabel label="Runtime" colors={colors} />
                <RuntimeRangeSliderInline
                  selectedRuntimeRanges={selectedRuntimeRanges}
                  onChange={setSelectedRuntimeRanges}
                />
              </>
            )}

            {/* Presets — only on the showtimes page */}
            {showPresets && (
              <>
                <Divider colors={colors} />
                <SectionLabel label="Presets" colors={colors} />
                <SavedPresetChips onApply={handleApplyPreset} variant="cards" />
                <View style={styles.presetActionsColumn}>
                  <TouchableOpacity
                    style={styles.cinemaOpenRow}
                    onPress={() => setSavePresetVisible(true)}
                    activeOpacity={0.8}
                  >
                    <View style={styles.cinemaOpenIcon}>
                      <MaterialIcons name="bookmark-add" size={17} color={colors.tint} />
                    </View>
                    <View style={styles.cinemaOpenTextBlock}>
                      <ThemedText style={styles.cinemaOpenTitle}>Save current filters</ThemedText>
                      <ThemedText style={styles.cinemaOpenSubtitle}>Save your active filters as a preset</ThemedText>
                    </View>
                    <MaterialIcons name="chevron-right" size={18} color={colors.textSecondary} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.cinemaOpenRow}
                    onPress={() => setManagePresetsVisible(true)}
                    activeOpacity={0.8}
                  >
                    <View style={styles.cinemaOpenIcon}>
                      <MaterialIcons name="tune" size={17} color={colors.tint} />
                    </View>
                    <View style={styles.cinemaOpenTextBlock}>
                      <ThemedText style={styles.cinemaOpenTitle}>Manage presets</ThemedText>
                      <ThemedText style={styles.cinemaOpenSubtitle}>Reorder, delete or set a default</ThemedText>
                    </View>
                    <MaterialIcons name="chevron-right" size={18} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>
              </>
            )}

            <TouchableOpacity
              style={styles.viewResultsButton}
              onPress={handleClose}
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
        </QueryClientProvider>
      </AppBottomSheet>
      {/* DayFilterModal is internal so day changes stay pending until FiltersModal closes */}
      <DayFilterModal
        visible={dayModalVisible}
        onClose={() => setDayModalVisible(false)}
        selectedDays={selectedDays}
        onChange={setSelectedDays}
      />
      <SavePresetDialog
        visible={savePresetVisible}
        onClose={() => setSavePresetVisible(false)}
        currentFilters={currentFilters}
        cinemaIds={sortedEffectiveIds}
        cinemaLabel={cinemaLabel}
        cinemaActive={cinemaActive}
        canUseWatchlistFilter={canUseWatchlistFilter}
        showRuntime={showRuntime}
        showGroupBy={showGroupByMovie}
      />
      <ManagePresetsModal
        visible={managePresetsVisible}
        onClose={() => setManagePresetsVisible(false)}
      />
    </>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────


function SectionLabel({ label, colors, prominent }: { label: string; colors: ReturnType<typeof useThemeColors>; prominent?: boolean }) {
  return prominent ? (
    <ThemedText style={{ color: colors.text, fontSize: 15, fontWeight: "700", marginBottom: 10 }}>
      {label}
    </ThemedText>
  ) : (
    <ThemedText style={{ color: colors.textSecondary, fontSize: 11, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 7 }}>
      {label}
    </ThemedText>
  );
}

function Divider({ colors }: { colors: ReturnType<typeof useThemeColors> }) {
  return <View style={{ height: 1, backgroundColor: colors.divider, marginVertical: 12 }} />;
}

function CountSkeleton() {
  return (
    <Skeleton style={{ height: 20, width: 140, borderRadius: 6, backgroundColor: "rgba(255,255,255,0.5)" }} />
  );
}

function Pill({ label, active, onPress, colors, style, isFavorite }: { label: string; active: boolean; onPress: () => void; colors: ReturnType<typeof useThemeColors>; style?: object; isFavorite?: boolean }) {
  return (
    <TouchableOpacity
      style={[{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: active ? colors.pillActiveBackground : colors.pillBackground, marginRight: 7, marginBottom: 7, flexDirection: "row", alignItems: "center", gap: 4 }, style]}
      onPress={() => {
        triggerSelectionHaptic();
        onPress();
      }}
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
    presetActionsColumn: { gap: 8 },
    cinemaPresetGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginBottom: 10,
    },
    cinemaPresetCard: {
      flexBasis: "47%",
      flexGrow: 1,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 12,
      borderWidth: 1.5,
      borderColor: colors.divider,
      backgroundColor: colors.cardBackground,
      gap: 4,
    },
    cinemaPresetCardActive: {
      borderColor: colors.tint,
      backgroundColor: colors.pillActiveBackground,
    },
    cinemaPresetCardRow: { flexDirection: "row", alignItems: "flex-start", gap: 4 },
    cinemaPresetName: { flex: 1, fontSize: 13, fontWeight: "600", color: colors.text },
    cinemaPresetNameActive: { color: colors.pillActiveText },
    cinemaPresetDesc: { fontSize: 11, color: colors.textSecondary },
    cinemaPresetDescActive: { color: colors.pillActiveText, opacity: 0.8 },
    cinemaOpenRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.divider,
      backgroundColor: colors.cardBackground,
    },
    cinemaOpenIcon: {
      width: 34,
      height: 34,
      borderRadius: 10,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.pillBackground,
    },
    cinemaOpenTextBlock: { flex: 1 },
    cinemaOpenTitle: { fontSize: 14, fontWeight: "600", color: colors.text },
    cinemaOpenSubtitle: { fontSize: 12, color: colors.textSecondary, marginTop: 1 },
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

  });
