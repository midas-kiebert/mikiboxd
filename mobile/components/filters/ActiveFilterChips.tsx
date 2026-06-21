/**
 * Mobile filter UI component: Active Filter Chips.
 * A scrollable row of chips for every currently-active filter dimension.
 * Regular chips have an × that removes only that filter.
 * The cinema chip is always present, has no ×, and opens a preset dropdown.
 */
import { useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, TouchableOpacity, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useFetchLetterboxdLists } from "shared/hooks/useLetterboxdLists";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import { getDaySelectionLabel } from "@/components/filters/day-filter-utils";
import { getPresetForRange } from "@/components/filters/time-filter-presets";
import { formatTimeRangeChipLabel, formatRuntimeRangeChipLabel } from "@/components/filters/time-range-utils";
import { type SharedTabShowtimeFilter } from "@/components/filters/shared-tab-filters";
import CinemaFilterChip from "@/components/filters/CinemaFilterChip";

type ActiveFilterChipsProps = {
  groupByMovie: boolean;
  setGroupByMovie: (v: boolean) => void;
  watchlistOnly: boolean;
  setWatchlistOnly: (v: boolean) => void;
  watchlistExclude?: boolean;
  setWatchlistExclude?: (v: boolean) => void;
  hideWatched: boolean;
  setHideWatched: (v: boolean) => void;
  watchedOnly?: boolean;
  setWatchedOnly?: (v: boolean) => void;
  canUseWatchlistFilter?: boolean;
  selectedShowtimeFilter: SharedTabShowtimeFilter;
  setSelectedShowtimeFilter: (v: SharedTabShowtimeFilter) => void;
  showStatusFilter?: boolean;
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
  /** When provided, the cinema chip is always rendered and opens the filters modal. */
  onOpenFilters?: () => void;
  /** Optional override for the cinema chip's "select cinemas" action (used outside the tab provider). */
  onOpenCinemaModal?: () => void;
  onClearAll?: () => void;
  /** Render inline (no bottom border, no background) with a leading vertical divider. */
  inline?: boolean;
};

type Chip = {
  key: string;
  label: string;
  onRemove: () => void;
};

const STATUS_LABEL: Record<SharedTabShowtimeFilter, string | null> = {
  all: null,
  interested: "Interested",
  going: "Going",
};

const EMPTY_LIST_IDS: string[] = [];

const RUNTIME_LABEL: Record<string, string> = {
  "0-90": "<90m",
  "90-120": "90-120m",
  "120-999": ">120m",
};

export default function ActiveFilterChips({
  groupByMovie,
  setGroupByMovie,
  watchlistOnly,
  setWatchlistOnly,
  watchlistExclude = false,
  setWatchlistExclude = () => {},
  hideWatched,
  setHideWatched,
  watchedOnly = false,
  setWatchedOnly = () => {},
  canUseWatchlistFilter = false,
  selectedShowtimeFilter,
  setSelectedShowtimeFilter,
  showStatusFilter = false,
  selectedDays,
  setSelectedDays,
  selectedTimeRanges,
  setSelectedTimeRanges,
  selectedRuntimeRanges,
  setSelectedRuntimeRanges,
  selectedListIds = EMPTY_LIST_IDS,
  setSelectedListIds = () => {},
  excludeListIds = EMPTY_LIST_IDS,
  setExcludeListIds = () => {},
  onOpenFilters,
  onOpenCinemaModal,
  onClearAll,
  inline = false,
}: ActiveFilterChipsProps) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const [hasMoreRight, setHasMoreRight] = useState(false);
  const contentW = useRef(0);
  const containerW = useRef(0);
  const { data: letterboxdLists = [] } = useFetchLetterboxdLists(
    selectedListIds.length > 0 || excludeListIds.length > 0
  );
  const listTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const list of letterboxdLists) map.set(list.id, list.title ?? list.list_slug);
    return map;
  }, [letterboxdLists]);

  const chips = useMemo<Chip[]>(() => {
    const result: Chip[] = [];

    if (groupByMovie) {
      result.push({
        key: "group-by-movie",
        label: "Grouped by Movie",
        onRemove: () => setGroupByMovie(false),
      });
    }

    if (showStatusFilter && selectedShowtimeFilter !== "all") {
      const label = STATUS_LABEL[selectedShowtimeFilter];
      if (label) {
        result.push({
          key: "status",
          label,
          onRemove: () => setSelectedShowtimeFilter("all"),
        });
      }
    }

    if (canUseWatchlistFilter && watchlistOnly) {
      result.push({
        key: "watchlist",
        label: "Watchlist",
        onRemove: () => setWatchlistOnly(false),
      });
    }

    if (canUseWatchlistFilter && watchlistExclude) {
      result.push({
        key: "watchlist-exclude",
        label: "Hide watchlist",
        onRemove: () => setWatchlistExclude(false),
      });
    }

    if (canUseWatchlistFilter && hideWatched) {
      result.push({
        key: "hide-watched",
        label: "Hide watched",
        onRemove: () => setHideWatched(false),
      });
    }

    if (canUseWatchlistFilter && watchedOnly) {
      result.push({
        key: "watched-only",
        label: "Watched only",
        onRemove: () => setWatchedOnly(false),
      });
    }

    for (const listId of selectedListIds) {
      result.push({
        key: `list-include-${listId}`,
        label: listTitleById.get(listId) ?? "List",
        onRemove: () => setSelectedListIds(selectedListIds.filter((id) => id !== listId)),
      });
    }

    for (const listId of excludeListIds) {
      result.push({
        key: `list-exclude-${listId}`,
        label: `Hide: ${listTitleById.get(listId) ?? "List"}`,
        onRemove: () => setExcludeListIds(excludeListIds.filter((id) => id !== listId)),
      });
    }

    for (const day of selectedDays) {
      result.push({
        key: `day-${day}`,
        label: getDaySelectionLabel(day),
        onRemove: () => setSelectedDays(selectedDays.filter((d) => d !== day)),
      });
    }

    for (const range of selectedTimeRanges) {
      const preset = getPresetForRange(range);
      const label = preset ? preset.label : formatTimeRangeChipLabel(range);
      result.push({
        key: `time-${range}`,
        label,
        onRemove: () => setSelectedTimeRanges(selectedTimeRanges.filter((r) => r !== range)),
      });
    }

    for (const range of selectedRuntimeRanges) {
      result.push({
        key: `runtime-${range}`,
        label: RUNTIME_LABEL[range] ?? formatRuntimeRangeChipLabel(range),
        onRemove: () =>
          setSelectedRuntimeRanges(selectedRuntimeRanges.filter((r) => r !== range)),
      });
    }

    return result;
  }, [
    groupByMovie,
    watchlistOnly,
    watchlistExclude,
    hideWatched,
    watchedOnly,
    canUseWatchlistFilter,
    selectedShowtimeFilter,
    showStatusFilter,
    selectedListIds,
    excludeListIds,
    listTitleById,
    selectedDays,
    selectedTimeRanges,
    selectedRuntimeRanges,
    setGroupByMovie,
    setWatchlistOnly,
    setWatchlistExclude,
    setHideWatched,
    setWatchedOnly,
    setSelectedShowtimeFilter,
    setSelectedListIds,
    setExcludeListIds,
    setSelectedDays,
    setSelectedTimeRanges,
    setSelectedRuntimeRanges,
  ]);

  // Don't render if there's nothing to show (no cinema chip and no filter chips)
  if (!onOpenFilters && chips.length === 0) return null;

  return (
    <View style={inline ? styles.inlineContainer : styles.container}>
      {inline && <View style={styles.inlineLeadDivider} />}
      <View style={styles.list}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={inline ? styles.inlineContent : styles.content}
          scrollEventThrottle={16}
          onLayout={(e) => {
            containerW.current = e.nativeEvent.layout.width;
            setHasMoreRight(contentW.current > e.nativeEvent.layout.width + 2);
          }}
          onContentSizeChange={(w) => {
            contentW.current = w;
            setHasMoreRight(w > containerW.current + 2);
          }}
          onScroll={(e) => {
            const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
            setHasMoreRight(contentOffset.x + layoutMeasurement.width < contentSize.width - 2);
          }}
        >
          {onOpenFilters && (
            <CinemaFilterChip onOpenFilters={onOpenFilters} onOpenCinemaModal={onOpenCinemaModal} />
          )}
          {chips.map((item) => (
            <TouchableOpacity
              key={item.key}
              style={styles.chip}
              onPress={item.onRemove}
              activeOpacity={0.75}
            >
              <ThemedText style={styles.chipLabel} numberOfLines={1}>
                {item.label}
              </ThemedText>
              <MaterialIcons name="close" size={12} color={colors.pillText} />
            </TouchableOpacity>
          ))}
        </ScrollView>
        {hasMoreRight && (
          <View style={styles.scrollFadeRight} pointerEvents="none">
            <MaterialIcons name="chevron-right" size={16} color={colors.textSecondary} />
          </View>
        )}
      </View>
      {onClearAll && chips.length > 0 && (
        <>
          <View style={styles.clearSeparator} />
          <TouchableOpacity onPress={onClearAll} style={styles.clearBtn}>
            <MaterialIcons name="close" size={18} color={colors.tint} />
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useThemeColors>) =>
  StyleSheet.create({
    container: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.background,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    inlineContainer: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
    },
    inlineLeadDivider: {
      width: 1,
      height: 16,
      alignSelf: "center",
      marginHorizontal: 10,
      backgroundColor: colors.divider,
    },
    inlineContent: {
      paddingLeft: 0,
      paddingRight: 8,
      paddingVertical: 7,
      gap: 8,
      alignItems: "center",
    },
    list: {
      flex: 1,
      position: "relative",
    },
    scrollFadeRight: {
      position: "absolute",
      right: 0,
      top: 0,
      bottom: 0,
      justifyContent: "center",
      paddingLeft: 4,
      backgroundColor: colors.background,
    },
    content: {
      paddingLeft: 16,
      paddingRight: 8,
      paddingVertical: 7,
      gap: 8,
      alignItems: "center",
    },
    clearSeparator: {
      width: 1,
      height: 20,
      backgroundColor: colors.divider,
    },
    clearBtn: {
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    chip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 14,
      backgroundColor: colors.pillBackground,
      alignSelf: "center",
      borderWidth: 1,
      borderColor: colors.divider,
    },
    chipLabel: {
      fontSize: 12,
      fontWeight: "500",
      color: colors.pillText,
      flexShrink: 1,
    },
  });
