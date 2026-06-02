/**
 * Mobile filter UI component: Filters Row.
 * Pill row only — "Filters" pill + preset pills + "Custom filter" pill.
 * FiltersModal is rendered by the screen so its position in the React tree
 * never changes when the layout switches (e.g. Group by Movie toggle).
 */
import { useMemo, useRef, useState } from "react";
import { FlatList, StyleSheet, TouchableOpacity, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useQuery } from "@tanstack/react-query";
import { MeService, type FilterPresetScope } from "shared";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import { type PageFilterPresetState } from "@/components/filters/FilterPresetsModal";
import { serializeFilters } from "@/components/filters/filter-preset-utils";

export type FiltersRowProps = {
  activeFilterCount: number;
  currentPresetFilters: PageFilterPresetState;
  scope: FilterPresetScope;
  groupByMovie: boolean;
  isModalOpen: boolean;
  onOpenModal: () => void;
  onApplyPreset: (preset: PageFilterPresetState) => void;
};

export default function FiltersRow({
  activeFilterCount,
  currentPresetFilters,
  scope,
  groupByMovie,
  isModalOpen: _isModalOpen,
  onOpenModal,
  onApplyPreset,
}: FiltersRowProps) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const [hasMoreRight, setHasMoreRight] = useState(false);
  const contentW = useRef(0);
  const containerW = useRef(0);

  const { data: filterPresets = [] } = useQuery({
    queryKey: ["user", "filter_presets", scope],
    queryFn: () => MeService.getFilterPresets({ scope }),
  });

  const serializedCurrentFilters = useMemo(
    () => serializeFilters(currentPresetFilters),
    [currentPresetFilters]
  );

  const matchingPresetId = useMemo(
    () =>
      filterPresets.find(
        (p) => serializeFilters(p.filters as PageFilterPresetState) === serializedCurrentFilters
      )?.id ?? null,
    [filterPresets, serializedCurrentFilters]
  );


  type PresetItem = { id: string; name: string };

  const presetItems: PresetItem[] = useMemo(
    () => filterPresets.filter((p) => !p.is_default).map((p) => ({ id: p.id, name: p.name })),
    [filterPresets]
  );

  const renderItem = ({ item }: { item: PresetItem }) => {
    const isActive = item.id === matchingPresetId;
    return (
      <TouchableOpacity
        style={[styles.pill, isActive && styles.pillActive]}
        onPress={() => {
          const preset = filterPresets.find((p) => p.id === item.id);
          if (preset) onApplyPreset(preset.filters as PageFilterPresetState);
        }}
        activeOpacity={0.8}
      >
        <ThemedText style={[styles.pillText, isActive && styles.pillTextActive]}>
          {item.name}
        </ThemedText>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {/* Pinned Filters button — never scrolls away */}
      <TouchableOpacity
        style={[styles.pill, styles.filtersPill]}
        onPress={onOpenModal}
        activeOpacity={0.8}
      >
        <View style={styles.pillContent}>
          <MaterialIcons name="tune" size={14} color={colors.pillText} />
          <ThemedText style={styles.pillText}>Filters</ThemedText>
        </View>
      </TouchableOpacity>

      {/* Vertical separator */}
      <View style={styles.separator} />

      {/* Scrollable preset pills */}
      <View style={styles.presetScroll}>
        <FlatList
          data={presetItems}
          keyExtractor={(item) => item.id}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.presetList}
          renderItem={renderItem}
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
        />
        {hasMoreRight && (
          <View style={styles.scrollFadeRight} pointerEvents="none">
            <MaterialIcons name="chevron-right" size={16} color={colors.textSecondary} />
          </View>
        )}
      </View>
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useThemeColors>) =>
  StyleSheet.create({
    container: {
      flexDirection: "row",
      alignItems: "center",
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
      backgroundColor: colors.background,
      paddingVertical: 10,
    },
    filtersPill: {
      marginLeft: 16,
      flexShrink: 0,
    },
    separator: {
      width: 1,
      height: 20,
      backgroundColor: colors.divider,
      marginHorizontal: 10,
      flexShrink: 0,
    },
    presetScroll: {
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
    presetList: {
      gap: 8,
      paddingRight: 16,
    },
    pill: {
      paddingHorizontal: 14,
      paddingVertical: 7,
      borderRadius: 18,
      backgroundColor: colors.pillBackground,
    },
    pillActive: {
      backgroundColor: colors.pillActiveBackground,
    },
    pillContent: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
    },
    pillText: {
      fontSize: 13,
      fontWeight: "500",
      color: colors.pillText,
    },
    pillTextActive: {
      fontSize: 13,
      fontWeight: "500",
      color: colors.pillActiveText,
    },
  });
