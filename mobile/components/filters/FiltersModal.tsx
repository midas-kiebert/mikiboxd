/**
 * Mobile filter UI component: Filters Modal.
 * Comprehensive bottom-sheet filter modal opened by the "Filters" pill.
 *
 * Top to bottom, in the website filter rail's order (`FeedFilterRail`):
 *
 *     Cinemas         opens the cinema sheet
 *     Feed style      screenings or films, and making that the default
 *     Letterboxd      watchlist · watched, or a field to link a username
 *     Language        English subtitled (or spoken), and making that the default
 *     When            days and time of day (folded)
 *     More filters    friends, Letterboxd lists, film length (folded)
 *     Clear filters
 *
 * The defaults (`useFeedDefaults`) are only ever written by "Make this the
 * default"; clearing puts language back to its default and leaves the feed
 * style alone, as on the website.
 *
 * A footer pinned below the scroll box holds the actions that end the visit —
 * applying the filters, and saving/managing quick filters — so they are
 * reachable from any scroll position. Quick filters themselves are applied
 * from the top bar (SavedPresetChips in PresetsRow), not from in here.
 */
import { useCallback, useMemo, useState } from "react";
import {
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

import { ThemedText } from "@/components/themed-text";
import { Skeleton } from "@/components/ui/Skeleton";
import { useThemeColors } from "@/hooks/use-theme-color";
import { useCinemaSelection } from "@/hooks/useCinemaSelection";
import { useOptimisticValue } from "@/hooks/useOptimisticValue";
import { formatDayPillLabel } from "@/components/filters/day-filter-utils";
import { type SharedTabShowtimeFilter } from "@/components/filters/shared-tab-filters";
import {
  hasAnyActiveFilter,
  type PageFilterPresetState,
} from "@/components/filters/filter-preset-utils";
import { useIsSignedIn } from "@/utils/auth-session";
import { isCinemaSelectionDifferentFromPreferred } from "@/utils/cinema-selection";
import SavePresetDialog from "@/components/filters/SavePresetDialog";
import ManagePresetsModal from "@/components/filters/ManagePresetsModal";
import { triggerSelectionHaptic } from "@/utils/long-press";
import TimeRangeSliderInline from "@/components/filters/TimeRangeSliderInline";
import RuntimeRangeSliderInline from "@/components/filters/RuntimeRangeSliderInline";
import { formatTimePillLabel } from "@/components/filters/time-range-utils";
import { formatRuntimePillLabel } from "@/components/filters/runtime-range-utils";
import DaysFilterSection from "@/components/filters/DaysFilterSection";
import SpecificDatesModal from "@/components/filters/SpecificDatesModal";
import LetterboxdListFilters, { LetterboxdWatchFilters } from "@/components/filters/LetterboxdFilters";
import FilterSection, {
  FilterHeadingRow,
  FilterInlineRow,
  FilterNavRow,
  FilterSubLabel,
} from "@/components/filters/FilterSection";
import { sameLanguages, useFeedDefaults } from "@/hooks/useFeedDefaults";
import SegmentedControl, { type SegmentedOption } from "@/components/ui/SegmentedControl";
import AppBottomSheet from "@/components/sheets/AppBottomSheet";
import { useFiltersModal } from "@/components/filters/filters-modal-context";
import type { OpenCinemaModalOptions } from "@/components/filters/CinemaFilterModal";
import useTrackEvent from "shared/hooks/useTrackEvent";

const FEED_STYLE_OPTIONS: readonly SegmentedOption<"screenings" | "films">[] = [
  { value: "screenings", label: "Screenings" },
  { value: "films", label: "Films" },
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
 * Checked is the default an agenda opens at: it holds both what its owner is
 * going to and what they are interested in. Unchecking it narrows to Going.
 */
const INTERESTED_FILTER_LABEL = "Include interested";

/**
 * Slack below the last section ("More filters") so its slider has somewhere to
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
  /**
   * An agenda's "interested as well as going" switch — the friend agenda's, so
   * off by default. Included is the unfiltered state; switching it off is what
   * puts the ⊘ Interested chip in the row above.
   */
  includeInterested?: boolean;
  setIncludeInterested?: (v: boolean) => void;
  showInterestedFilter?: boolean;
  showCinemas?: boolean;
  /** Override the cinema modal opener (for pages rendered outside FiltersModalProvider). */
  onOpenCinemaModal?: (options?: OpenCinemaModalOptions) => void;
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
  includeInterested = true,
  setIncludeInterested = () => {},
  showInterestedFilter = false,
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
  const { openCinemaModal: providerOpenCinemaModal } = useFiltersModal();
  const openCinemaModal = onOpenCinemaModal ?? providerOpenCinemaModal;
  const [specificDatesVisible, setSpecificDatesVisible] = useState(false);
  const { trackEvent } = useTrackEvent();
  // Analytics events are recorded against an account, so there is nobody to
  // record a guest's against — the call would 401 and be swallowed.
  const isSignedIn = useIsSignedIn();
  // Filters apply live as the user taps pills, so any way of dismissing this
  // sheet — the "View results" button, swipe-down, or backdrop tap — commits
  // the current filter state. Track it here, not just on the button, so the
  // swipe/backdrop paths (handled by AppBottomSheet's onClose) aren't missed.
  const handleClose = useCallback(() => {
    if (isSignedIn) trackEvent("filter_applied");
    onClose();
  }, [isSignedIn, trackEvent, onClose]);

  const { data: allCinemas = [] } = useFetchCinemas();
  // The cinema list is public; the account's saved picks and named presets are
  // not. A guest's selection is the session value itself, persisted to the
  // device by `useCinemaSelection`.
  const { data: preferredCinemaIds } = useFetchSelectedCinemas({ enabled: isSignedIn });
  const { cinemaIds: sessionCinemaIds, setCinemaIds } = useCinemaSelection();
  const { data: cinemaPresets = [] } = useQuery({
    queryKey: ["cinema-presets"],
    queryFn: () => MeService.getCinemaPresets(),
    enabled: isSignedIn,
  });

  const sortedEffectiveIds = useMemo(() => {
    const effectiveCinemaIds = sessionCinemaIds ?? preferredCinemaIds ?? [];
    return Array.from(new Set(effectiveCinemaIds)).sort((a, b) => a - b);
  }, [sessionCinemaIds, preferredCinemaIds]);


  const whenSummary = useMemo(() => {
    const parts: string[] = [];
    if (selectedDays.length > 0) parts.push(formatDayPillLabel(selectedDays));
    if (selectedTimeRanges.length > 0) parts.push(formatTimePillLabel(selectedTimeRanges));
    return parts.length > 0 ? parts.join(", ") : "Any day, any time";
  }, [selectedDays, selectedTimeRanges]);

  // Short summary of "More filters" shown in its header while collapsed. Only
  // counts what that section actually renders on this page.
  const moreFiltersSummary = useMemo(() => {
    const parts: string[] = [];
    if (showStatusFilter && selectedShowtimeFilter !== "all") {
      parts.push(selectedShowtimeFilter === "going" ? "Friends going" : "Friends interested");
    }
    if (showInterestedFilter && !includeInterested) parts.push("Going only");
    if (showLists) {
      const listCount = selectedListIds.length + excludeListIds.length;
      if (listCount > 0) parts.push(`${listCount} list${listCount === 1 ? "" : "s"}`);
    }
    if (showRuntime && selectedRuntimeRanges.length > 0) {
      parts.push(formatRuntimePillLabel(selectedRuntimeRanges));
    }
    return parts.length > 0 ? parts.join(", ") : "Any";
  }, [
    showStatusFilter,
    selectedShowtimeFilter,
    showInterestedFilter,
    includeInterested,
    showLists,
    selectedListIds,
    excludeListIds,
    showRuntime,
    selectedRuntimeRanges,
  ]);
  const showMoreFilters = showStatusFilter || showInterestedFilter || showLists || showRuntime;

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

  // Drives the "Save as quick filter" highlight: there is only something worth
  // saving once the user has actually narrowed something down (a cinema
  // selection counts here, even though hasAnyActiveFilter ignores it — saving a
  // quick filter does store the cinemas).
  const hasSomethingToSave = useMemo(
    () => hasAnyActiveFilter(currentFilters) || cinemaActive,
    [currentFilters, cinemaActive]
  );

  const {
    defaultGroupByMovie,
    defaultLanguages,
    setDefaultGroupByMovie,
    setDefaultLanguages,
  } = useFeedDefaults();

  // Clearing works as it does on the website: the feed style is a view, not a
  // filter, so it is never cleared; language goes back to its default rather
  // than off; cinemas go back to the preferred ones. So a feed sitting at its
  // defaults has nothing to clear — plus the interested switch, which no
  // quick filter carries (it belongs to one agenda) but clearing still resets.
  const languagesAreDefault = sameLanguages(selectedLanguages, defaultLanguages);
  const hasSomethingToClear =
    hasAnyActiveFilter({
      ...currentFilters,
      group_by_movie: false,
      selected_languages: languagesAreDefault ? null : selectedLanguages,
    }) ||
    cinemaActive ||
    (showInterestedFilter && !includeInterested);

  const handleClearFilters = () => {
    triggerSelectionHaptic();
    setSelectedShowtimeFilter("all");
    // Included is this filter's unfiltered state, so clearing puts it back on.
    setIncludeInterested(true);
    setWatchlistOnly(false);
    setWatchlistExclude(false);
    setHideWatched(false);
    setWatchedOnly(false);
    setSelectedDays([]);
    setSelectedTimeRanges([]);
    setSelectedRuntimeRanges([]);
    setSelectedListIds([]);
    setExcludeListIds([]);
    setSelectedLanguages([...defaultLanguages]);
    if (preferredCinemaIds) setCinemaIds(preferredCinemaIds);
  };

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
  const { value: displayIncludeInterested, change: changeIncludeInterested } =
    useOptimisticValue(includeInterested, setIncludeInterested);
  const displayLanguages: Language[] = displayEnglishOnly ? [ENGLISH] : [];

  return (
    <>
        <AppBottomSheet
          visible={visible}
          onClose={handleClose}
          title="Filters"
          loadingLabel="Loading filters…"
          // Warmed so it never pays for its own mount on an open — and warmed
          // *before* CinemaFilterModal, which has to draw in front of it. See
          // `sheet-warm-up`; the order is the order the two components mount.
          warmUpOnMount
        >
          {/* @gorhom/portal (used by the bottom sheet) does not forward React
              context, so re-provide the QueryClient for hooks rendered inside. */}
          <QueryClientProvider client={queryClient}>
          {/* Freshly mounted on every open — AppBottomSheet holds the body back
              until the sheet is up and drops it again after the close — so the
              sheet always starts at the top with no scroll reset of its own. */}
          <BottomSheetScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
              {/* Cinemas: presets already live in the main page's cinema dropdown,
                  so this row only ever opens the cinema selection modal. */}
              {showCinemas && (
                <>
                  <FilterNavRow label="Cinemas" summary={cinemaLabel} onPress={openCinemaModal} />
                  <Divider colors={colors} />
              </>
            )}

            {showGroupByMovie && (
              <>
                <FilterHeadingRow
                  label="Feed style"
                  action={
                    <MakeDefaultButton
                      isDefault={displayGroupByMovie === defaultGroupByMovie}
                      onPress={() => setDefaultGroupByMovie(displayGroupByMovie)}
                      colors={colors}
                    />
                  }
                />
                <SegmentedControl
                  options={FEED_STYLE_OPTIONS}
                  value={displayGroupByMovie ? "films" : "screenings"}
                  onChange={(value) => changeGroupByMovie(value === "films")}
                  accessibilityLabelPrefix="Feed style"
                  stretch
                />
                <Divider colors={colors} />
              </>
            )}

            {/* The film-level filters. Absent on a page about one film. */}
            {showLists && (
              <>
                <FilterHeadingRow label="Letterboxd" />
                <LetterboxdWatchFilters
                  colors={colors}
                  canUseWatchlistFilter={canUseWatchlistFilter}
                  watchlistOnly={watchlistOnly}
                  setWatchlistOnly={setWatchlistOnly}
                  setWatchlistExclude={setWatchlistExclude}
                  hideWatched={hideWatched}
                  setHideWatched={setHideWatched}
                  setWatchedOnly={setWatchedOnly}
                />
                <Divider colors={colors} />
              </>
            )}

            <FilterHeadingRow
              label="Language"
              action={
                <MakeDefaultButton
                  isDefault={sameLanguages(displayLanguages, defaultLanguages)}
                  onPress={() => setDefaultLanguages(displayLanguages)}
                  colors={colors}
                />
              }
            />
            <View style={styles.pillRow}>
              <Pill
                label={ENGLISH_FILTER_LABEL}
                icon={displayEnglishOnly ? "check-box" : "check-box-outline-blank"}
                active={displayEnglishOnly}
                onPress={() => changeEnglishOnly(!displayEnglishOnly)}
                colors={colors}
                style={styles.inlineControlPill}
              />
            </View>
            <Divider colors={colors} />

            <FilterSection label="When" summary={whenSummary}>
              <FilterSubLabel label="Days" isFirst />
              <DaysFilterSection
                selectedDays={selectedDays}
                onChange={setSelectedDays}
                onOpenSpecificDates={() => setSpecificDatesVisible(true)}
              />
              <FilterSubLabel label="Time of day" />
              <TimeRangeSliderInline
                selectedTimeRanges={selectedTimeRanges}
                onChange={setSelectedTimeRanges}
              />
            </FilterSection>
            <Divider colors={colors} />

            {showMoreFilters && (
              <>
                <FilterSection label="More filters" summary={moreFiltersSummary}>
                  {(showStatusFilter || showInterestedFilter) && (
                    <View style={styles.inlineRowGroup}>
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
                      {showInterestedFilter && (
                        <FilterInlineRow label="Interested">
                          <Pill
                            label={INTERESTED_FILTER_LABEL}
                            icon={displayIncludeInterested ? "check-box" : "check-box-outline-blank"}
                            active={displayIncludeInterested}
                            onPress={() => changeIncludeInterested(!displayIncludeInterested)}
                            colors={colors}
                            style={styles.inlineControlPill}
                          />
                        </FilterInlineRow>
                      )}
                    </View>
                  )}
                  {showLists && (
                    <LetterboxdListFilters
                      colors={colors}
                      isFirst={!showStatusFilter && !showInterestedFilter}
                      selectedListIds={selectedListIds}
                      setSelectedListIds={setSelectedListIds}
                      excludeListIds={excludeListIds}
                      setExcludeListIds={setExcludeListIds}
                    />
                  )}
                  {showRuntime && (
                    <>
                      <FilterSubLabel
                        label="Film length"
                        isFirst={!showStatusFilter && !showInterestedFilter && !showLists}
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

            {/* Below the last filter rather than in the footer: it undoes what
                is above it, and the space under the sections was empty anyway.
                Text, not a button — a bordered control down here would read as
                a fourth thing to decide about, and clearing is a way back, not
                an action the sheet is asking for. */}
            <TouchableOpacity
              style={styles.clearFiltersLink}
              onPress={handleClearFilters}
              // Quiet until there is something to undo: a clear control with
              // nothing to clear is a dead control, not a shortcut.
              disabled={!hasSomethingToClear}
              activeOpacity={0.6}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Clear filters"
            >
              <MaterialIcons
                name="filter-alt-off"
                size={17}
                color={hasSomethingToClear ? colors.tint : colors.textSecondary}
                style={!hasSomethingToClear ? styles.clearFiltersIdle : undefined}
              />
              <ThemedText
                style={[
                  styles.clearFiltersText,
                  !hasSomethingToClear && styles.clearFiltersTextIdle,
                ]}
              >
                Clear filters
              </ThemedText>
            </TouchableOpacity>
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
                  Save as quick filter
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
                accessibilityLabel="Manage quick filters"
              >
                <MaterialIcons name="tune" size={17} color={colors.textSecondary} />
                <ThemedText style={styles.presetButtonText} numberOfLines={1}>
                  Quick filters
                </ThemedText>
              </TouchableOpacity>
            </View>
          )}
          <TouchableOpacity
            style={styles.viewResultsButton}
            onPress={() => {
              triggerSelectionHaptic();
              handleClose();
            }}
            activeOpacity={0.85}
          >
            {resultCount !== undefined ? (
              <ThemedText style={styles.viewResultsButtonText}>
                View {resultCount} {groupByMovie ? "Films" : "Screenings"}
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

/**
 * "Make this the default" at the right of a section heading — or, muted and
 * inert, "This is the default" once it is. The website rail's button: the
 * control above only ever changes this visit, and the default only changes
 * when you say so.
 */
function MakeDefaultButton({
  isDefault,
  onPress,
  colors,
}: {
  isDefault: boolean;
  onPress: () => void;
  colors: ReturnType<typeof useThemeColors>;
}) {
  const color = isDefault ? colors.textSecondary : colors.tint;
  return (
    <TouchableOpacity
      onPress={() => {
        triggerSelectionHaptic();
        onPress();
      }}
      disabled={isDefault}
      activeOpacity={0.6}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDefault }}
      style={{ flexDirection: "row", alignItems: "center", gap: 3 }}
    >
      {isDefault && <MaterialIcons name="check" size={13} color={color} />}
      <ThemedText style={{ fontSize: 12, lineHeight: 16, fontWeight: "600", color }}>
        {isDefault ? "This is the default" : "Make this the default"}
      </ThemedText>
    </TouchableOpacity>
  );
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
      style={[{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: active ? colors.pillActiveBackground : colors.pillBackground, borderWidth: 1, borderColor: active ? colors.pillActiveBackground : colors.pillBorder, marginRight: 7, marginBottom: 7, flexDirection: "row", alignItems: "center", gap: 4 }, style]}
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
      // "Save as quick filter" is the primary of the two, so it takes the
      // leftover width while "Manage" stays at its label's size.
      flex: 1,
    },
    // Saving is only worth a tap once something is actually filtered, so the
    // button stays quiet until then. Highlighted as a soft tinted fill, outlined
    // in the accent's own border tone: the fill alone has almost no edge against
    // the footer, which left it reading as a patch of colour rather than a
    // control. Not the tint the "View results" button below uses — this stays
    // the quieter of the two. Same border width in both states, so nothing
    // shifts when it flips.
    presetButtonHighlighted: {
      backgroundColor: colors.green.primary,
      borderColor: colors.green.border,
    },
    managePresetsButton: { flex: 0 },
    // Sits in the run-out space under the last section, centred so it does not
    // read as another labelled row in the list above it. Still text rather than
    // a control — the icon and the weight are what carry it, not a box.
    clearFiltersLink: {
      flexDirection: "row",
      alignItems: "center",
      alignSelf: "center",
      gap: 7,
      paddingHorizontal: 16,
      paddingVertical: 16,
    },
    clearFiltersText: {
      fontSize: 15,
      // ThemedText's default type carries a 24pt line height that survives the
      // size override, which would sit the label off-centre against the icon.
      lineHeight: 20,
      fontWeight: "700",
      color: colors.tint,
    },
    clearFiltersIdle: { opacity: 0.5 },
    clearFiltersTextIdle: { color: colors.textSecondary, opacity: 0.5 },
    presetButtonText: { fontSize: 13, fontWeight: "600", color: colors.textSecondary },
    presetButtonTextHighlighted: { color: colors.green.secondary },
    viewResultsButton: {
      backgroundColor: colors.tint,
      paddingHorizontal: 20,
      paddingVertical: 16,
      borderRadius: 14,
      alignItems: "center",
    },
    // The shared on-tint text colour rather than a hardcoded black: the light
    // theme's tint is a deep green, and black on it was barely readable.
    viewResultsButtonText: {
      color: colors.pillActiveText,
      fontWeight: "700",
      fontSize: 15,
      lineHeight: 20,
    },

  });
