/**
 * Mobile filter UI component: Filters Modal.
 * Comprehensive bottom-sheet filter modal opened by the "Filters" pill.
 *
 * Laid out as a scroll box of collapsible sections plus a footer pinned below
 * it. The footer holds the actions that end the visit — applying the filters,
 * and saving/managing presets — so they are reachable from any scroll
 * position. Saved presets themselves are applied from the top bar
 * (SavedPresetChips in FiltersRow), not from in here.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
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
import {
  hasAnyActiveFilter,
  type PageFilterPresetState,
} from "@/components/filters/filter-preset-utils";
import { isCinemaSelectionDifferentFromPreferred } from "@/utils/cinema-selection";
import SavePresetDialog from "@/components/filters/SavePresetDialog";
import ManagePresetsModal from "@/components/filters/ManagePresetsModal";
import { triggerSelectionHaptic } from "@/utils/long-press";
import TimeRangeSliderInline from "@/components/filters/TimeRangeSliderInline";
import RuntimeRangeSliderInline from "@/components/filters/RuntimeRangeSliderInline";
import DaysFilterSection from "@/components/filters/DaysFilterSection";
import SpecificDatesModal from "@/components/filters/SpecificDatesModal";
import FilterMoviesSection from "@/components/filters/FilterMoviesSection";
import FilterSection, { FilterInlineRow, FilterSubLabel } from "@/components/filters/FilterSection";
import SegmentedControl, { type SegmentedOption } from "@/components/ui/SegmentedControl";
import AppBottomSheet from "@/components/sheets/AppBottomSheet";
import { useFiltersModal } from "@/components/filters/FiltersModalProvider";
import useTrackEvent from "shared/hooks/useTrackEvent";

const GROUP_BY_OPTIONS: readonly SegmentedOption<"showtimes" | "movies">[] = [
  { value: "showtimes", label: "Showtimes" },
  { value: "movies", label: "Movies" },
];

// Icons and palettes match how a status is drawn everywhere else (orange
// bookmark for interested, green check for going).
const FRIEND_STATUS_OPTIONS: readonly {
  value: SharedTabShowtimeFilter;
  label: string;
  icon?: keyof typeof MaterialIcons.glyphMap;
  palette?: "orange" | "green";
}[] = [
  { value: "all", label: "Any" },
  { value: "interested", label: "Interested", icon: "bookmark", palette: "orange" },
  { value: "going", label: "Going", icon: "check-circle", palette: "green" },
];

/**
 * The one language filter, spelled out: the backend matches a movie whose
 * original language is English *or* which is subtitled in English.
 */
const ENGLISH_FILTER_LABEL = "English subtitled (or spoken)";
const ENGLISH: Language = "en";

/**
 * Slack below the last section ("Time of day") so its slider has somewhere to
 * appear when the section is expanded from the bottom of the scroll: without it
 * the content mounts just past the viewport and you have to scroll down again to
 * reach the control you just opened. Sized to the expanded section's own height
 * (FilterSection's content margin plus the slider row).
 */
const LAST_SECTION_EXPAND_SPACE = 56;

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
  const [specificDatesVisible, setSpecificDatesVisible] = useState(false);
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

  // Drives the "Save current filters" highlight: there is only something worth
  // saving once the user has actually narrowed something down (a cinema
  // selection counts here, even though hasAnyActiveFilter ignores it — saving a
  // preset does store the cinemas).
  const hasSomethingToSave = useMemo(
    () => hasAnyActiveFilter(currentFilters) || cinemaActive,
    [currentFilters, cinemaActive]
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
  const englishOnly = selectedLanguages.includes(ENGLISH);
  const { value: displayEnglishOnly, change: changeEnglishOnly } = useOptimisticValue(
    englishOnly,
    useCallback(
      (next: boolean) => setSelectedLanguages(next ? [ENGLISH] : []),
      [setSelectedLanguages]
    )
  );

  // "Any" is the unfiltered default, so its thumb stays neutral instead of
  // lighting up like a filter that is switched on.
  const friendStatusOptions = useMemo<SegmentedOption<SharedTabShowtimeFilter>[]>(
    () =>
      FRIEND_STATUS_OPTIONS.map(({ palette, ...option }) => ({
        ...option,
        activeBackground: palette ? colors[palette].primary : colors.cardBackground,
        activeForeground: palette ? colors[palette].secondary : colors.text,
      })),
    [colors]
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
          contentContainerStyle={styles.scrollContent}
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
                <FilterSection label="Cinemas">
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
                </FilterSection>
                <Divider colors={colors} />
              </>
            )}

            {/* One-control sections: each is a single row rather than a
                collapsible, and they sit together between one pair of dividers. */}
            <View style={styles.inlineRowGroup}>
              {showGroupByMovie && (
                <FilterInlineRow label="Group By">
                  <SegmentedControl
                    options={GROUP_BY_OPTIONS}
                    value={displayGroupByMovie ? "movies" : "showtimes"}
                    onChange={(value) => changeGroupByMovie(value === "movies")}
                    accessibilityLabelPrefix="Group by"
                  />
                </FilterInlineRow>
              )}

              {showStatusFilter && (
                <FilterInlineRow label="Marked by Friends">
                  <SegmentedControl
                    options={friendStatusOptions}
                    value={displayShowtimeFilter}
                    onChange={changeShowtimeFilter}
                    accessibilityLabelPrefix="Marked by friends"
                  />
                </FilterInlineRow>
              )}

              <FilterInlineRow label="Language">
                <Pill
                  label={ENGLISH_FILTER_LABEL}
                  icon={displayEnglishOnly ? "check-box" : "check-box-outline-blank"}
                  active={displayEnglishOnly}
                  onPress={() => changeEnglishOnly(!displayEnglishOnly)}
                  colors={colors}
                  style={styles.inlineControlPill}
                />
              </FilterInlineRow>
            </View>
            <Divider colors={colors} />

            {/* Everything that filters on the film itself: which of the user's
                Letterboxd sets it belongs to, and how long it is. */}
            {(showRuntime || showLists || canUseWatchlistFilter) && (
              <>
                <FilterSection label="Movie Filters">
                  {showLists ? (
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
                  ) : (
                    canUseWatchlistFilter && (
                      <>
                        <FilterSubLabel label="Watchlist" isFirst />
                        <View style={styles.pillRow}>
                          <Pill label="All movies" active={!displayWatchlistOnlySimple} onPress={() => changeWatchlistOnlySimple(false)} colors={colors} />
                          <Pill label="Watchlisted only" active={displayWatchlistOnlySimple} onPress={() => changeWatchlistOnlySimple(true)} colors={colors} />
                        </View>
                        <View style={styles.pillRow}>
                          <Pill label="Hide watched" active={displayHideWatchedSimple} onPress={() => changeHideWatchedSimple(!displayHideWatchedSimple)} colors={colors} />
                        </View>
                      </>
                    )
                  )}
                  {showRuntime && (
                    <>
                      <FilterSubLabel
                        label="Movie Length"
                        isFirst={!showLists && !canUseWatchlistFilter}
                      />
                      <RuntimeRangeSliderInline
                        selectedRuntimeRanges={selectedRuntimeRanges}
                        onChange={setSelectedRuntimeRanges}
                      />
                    </>
                  )}
                </FilterSection>
                <Divider colors={colors} />
              </>
            )}

            {/* Days */}
            <FilterSection label="Days" summary={dayLabel}>
              <DaysFilterSection
                selectedDays={selectedDays}
                onChange={setSelectedDays}
                onOpenSpecificDates={() => setSpecificDatesVisible(true)}
              />
            </FilterSection>

            <Divider colors={colors} />

            {/* Time */}
            <FilterSection label="Time of day">
              <TimeRangeSliderInline
                selectedTimeRanges={selectedTimeRanges}
                onChange={setSelectedTimeRanges}
              />
            </FilterSection>

          </>)}
        </BottomSheetScrollView>

        {/* Pinned footer: the actions stay reachable at any scroll position,
            since the filters above are long enough that scrolling back down to
            apply them was a chore. */}
        <View style={[styles.footer, { paddingBottom: bottomInset + 12 }]}>
          {showPresets && (
            <View style={styles.presetActionsRow}>
              <TouchableOpacity
                style={[styles.presetButton, hasSomethingToSave && styles.presetButtonHighlighted]}
                onPress={() => {
                  triggerSelectionHaptic();
                  setSavePresetVisible(true);
                }}
                activeOpacity={0.8}
                accessibilityRole="button"
              >
                <MaterialIcons
                  name="bookmark-add"
                  size={17}
                  color={hasSomethingToSave ? colors.green.secondary : colors.textSecondary}
                />
                <ThemedText
                  style={[
                    styles.presetButtonText,
                    hasSomethingToSave && styles.presetButtonTextHighlighted,
                  ]}
                  numberOfLines={1}
                >
                  Save current filters
                </ThemedText>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.presetButton, styles.managePresetsButton]}
                onPress={() => {
                  triggerSelectionHaptic();
                  setManagePresetsVisible(true);
                }}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Manage presets"
              >
                <MaterialIcons name="tune" size={17} color={colors.textSecondary} />
                <ThemedText style={styles.presetButtonText} numberOfLines={1}>
                  Presets
                </ThemedText>
              </TouchableOpacity>
            </View>
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
        </View>
        </QueryClientProvider>
      </AppBottomSheet>
      {/* The calendar is internal so date changes stay pending until FiltersModal closes */}
      <SpecificDatesModal
        visible={specificDatesVisible}
        onClose={() => setSpecificDatesVisible(false)}
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


function Divider({ colors }: { colors: ReturnType<typeof useThemeColors> }) {
  return <View style={{ height: 1, backgroundColor: colors.divider, marginVertical: 8 }} />;
}

function CountSkeleton() {
  // No backgroundColor override: Skeleton's own themed fill is the only one
  // that shows up in both schemes. A hardcoded translucent white was invisible
  // against the light theme's white card.
  return <Skeleton style={{ height: 20, width: 140, borderRadius: 6 }} />;
}

function Pill({ label, active, onPress, colors, style, icon }: { label: string; active: boolean; onPress: () => void; colors: ReturnType<typeof useThemeColors>; style?: object; icon?: keyof typeof MaterialIcons.glyphMap }) {
  return (
    <TouchableOpacity
      style={[{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: active ? colors.pillActiveBackground : colors.pillBackground, marginRight: 7, marginBottom: 7, flexDirection: "row", alignItems: "center", gap: 4 }, style]}
      onPress={() => {
        triggerSelectionHaptic();
        onPress();
      }}
      activeOpacity={0.8}
    >
      {icon && <MaterialIcons name={icon} size={14} color={active ? colors.pillActiveText : colors.pillText} />}
      <ThemedText style={{ fontSize: 13, fontWeight: "500", color: active ? colors.pillActiveText : colors.pillText }}>
        {label}
      </ThemedText>
    </TouchableOpacity>
  );
}

const createStyles = (colors: ReturnType<typeof useThemeColors>) =>
  StyleSheet.create({
    // The scroll box owns the full width between the header and the pinned
    // footer; only its content is inset.
    scroll: { flex: 1 },
    scrollContent: {
      paddingHorizontal: 20,
      paddingTop: 14,
      paddingBottom: 24 + LAST_SECTION_EXPAND_SPACE,
    },

    pillRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
    inlineRowGroup: { gap: 2 },
    // A pill used as the control of an inline row carries no row/wrap margins.
    inlineControlPill: { marginRight: 0, marginBottom: 0, flexShrink: 1 },
    footer: {
      paddingHorizontal: 20,
      paddingTop: 12,
      gap: 10,
      borderTopWidth: 1,
      borderTopColor: colors.divider,
      backgroundColor: colors.background,
    },
    presetActionsRow: { flexDirection: "row", alignItems: "stretch", gap: 8 },
    presetButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 7,
      paddingHorizontal: 14,
      paddingVertical: 11,
      borderRadius: 12,
      borderWidth: 1.5,
      borderColor: colors.divider,
      backgroundColor: colors.cardBackground,
      // "Save current filters" is the primary of the two, so it takes the
      // leftover width while "Manage" stays at its label's size.
      flex: 1,
    },
    // Saving is only worth a tap once something is actually filtered, so the
    // button stays quiet until then. Highlighted as a soft tinted fill rather
    // than a tint-coloured outline: a ring competes with the solid tint button
    // right below it, while the muted fill reads as "available" without
    // claiming to be the sheet's primary action. The border stays at the same
    // width (just tinted to match) so nothing shifts when the state flips.
    presetButtonHighlighted: {
      backgroundColor: colors.green.primary,
      borderColor: colors.green.primary,
    },
    managePresetsButton: { flex: 0 },
    presetButtonText: { fontSize: 13, fontWeight: "600", color: colors.textSecondary },
    presetButtonTextHighlighted: { color: colors.green.secondary },
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
      backgroundColor: colors.tint,
      paddingHorizontal: 20,
      paddingVertical: 16,
      borderRadius: 14,
      alignItems: "center",
    },
    viewResultsButtonText: { color: "#000", fontWeight: "700", fontSize: 15, lineHeight: 20 },

  });
