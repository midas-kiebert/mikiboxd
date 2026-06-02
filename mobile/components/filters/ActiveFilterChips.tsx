/**
 * Mobile filter UI component: Active Filter Chips.
 * A scrollable row of chips for every currently-active filter dimension.
 * Each chip has an × that removes only that filter.
 */
import { useMemo, useRef, useState } from "react";
import { FlatList, StyleSheet, TouchableOpacity, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import { getDaySelectionLabel } from "@/components/filters/day-filter-utils";
import { getPresetForRange } from "@/components/filters/time-filter-presets";
import { formatTimeRangeChipLabel, formatRuntimeRangeChipLabel } from "@/components/filters/time-range-utils";
import { type SharedTabShowtimeFilter } from "@/components/filters/shared-tab-filters";

type ActiveFilterChipsProps = {
  groupByMovie: boolean;
  setGroupByMovie: (v: boolean) => void;
  watchlistOnly: boolean;
  setWatchlistOnly: (v: boolean) => void;
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
  // Cinema chip label (e.g. preset name or "N cinemas")
  cinemaChipLabel?: string | null;
  onClearCinemas?: () => void;
  onClearAll?: () => void;
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
  cinemaChipLabel,
  onClearCinemas,
  onClearAll,
}: ActiveFilterChipsProps) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const [hasMoreRight, setHasMoreRight] = useState(false);
  const contentW = useRef(0);
  const containerW = useRef(0);

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

    if (cinemaChipLabel && onClearCinemas) {
      result.push({
        key: "cinemas",
        label: cinemaChipLabel,
        onRemove: onClearCinemas,
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
    canUseWatchlistFilter,
    selectedShowtimeFilter,
    showStatusFilter,
    cinemaChipLabel,
    selectedDays,
    selectedTimeRanges,
    selectedRuntimeRanges,
  ]);

  if (chips.length === 0) return null;

  return (
    <View style={styles.container}>
      <View style={styles.list}>
        <FlatList
          data={chips}
          keyExtractor={(item) => item.key}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.content}
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
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.chip}
              onPress={item.onRemove}
              activeOpacity={0.75}
            >
              <ThemedText style={styles.chipLabel} numberOfLines={1}>
                {item.label}
              </ThemedText>
              <MaterialIcons name="close" size={12} color={colors.pillText} />
            </TouchableOpacity>
          )}
        />
        {hasMoreRight && (
          <View style={styles.scrollFadeRight} pointerEvents="none">
            <MaterialIcons name="chevron-right" size={16} color={colors.textSecondary} />
          </View>
        )}
      </View>
      {onClearAll && (
        <>
          <View style={styles.clearSeparator} />
          <TouchableOpacity onPress={onClearAll} style={styles.clearBtn}>
            <ThemedText style={styles.clearText}>Clear filters</ThemedText>
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
    clearText: {
      fontSize: 13,
      color: colors.tint,
      fontWeight: "500",
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
