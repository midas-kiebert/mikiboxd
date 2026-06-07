import { useMemo, useRef, useState } from "react";
import { Alert, StyleSheet, TouchableOpacity, View } from "react-native";
import { ScrollView as GHScrollView } from "react-native-gesture-handler";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { type FilterPresetScope } from "shared";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import {
  describeDisplayPreset,
  type DisplayPreset,
} from "@/components/filters/saved-presets";
import { useDisplayPresets } from "@/components/filters/useDisplayPresets";

type SavedPresetChipsProps = {
  scope: FilterPresetScope;
  onApply: (preset: DisplayPreset) => void;
  /** "cards" = wrapping card grid (FiltersModal). "chips" = horizontal scroll pills (top bar). */
  variant?: "cards" | "chips";
};
;

export default function SavedPresetChips({
  scope,
  onApply,
  variant = "cards",
}: SavedPresetChipsProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { presets, isLoading, remove } = useDisplayPresets(scope);

  const confirmDelete = (preset: DisplayPreset) => {
    Alert.alert(
      "Delete preset?",
      `Remove "${preset.name}"?`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => remove(preset) },
      ],
      { cancelable: true }
    );
  };

  if (variant === "cards") {
    if (isLoading || presets.length === 0) return null;
    return (
      <View style={styles.grid}>
        {presets.map((preset) => {
          const description = describeDisplayPreset(preset);
          return (
            <TouchableOpacity
              key={`${preset.source}-${preset.id}`}
              style={styles.card}
              onPress={() => onApply(preset)}
              onLongPress={() => confirmDelete(preset)}
              delayLongPress={300}
              activeOpacity={0.75}
            >
              <View style={styles.cardRow}>
                <ThemedText style={styles.cardName} numberOfLines={2}>
                  {preset.name}
                </ThemedText>
                {preset.isFavorite && (
                  <MaterialIcons name="star" size={13} color={colors.yellow.secondary} />
                )}
              </View>
              {description.length > 0 && (
                <ThemedText style={styles.cardDesc} numberOfLines={3}>
                  {description}
                </ThemedText>
              )}
            </TouchableOpacity>
          );
        })}
      </View>
    );
  }

  // chips variant — horizontal scroll
  return <ChipsScroll presets={presets} isLoading={isLoading} onApply={onApply} onLongPress={confirmDelete} styles={styles} colors={colors} />;
}

function ChipsScroll({
  presets,
  isLoading,
  onApply,
  onLongPress,
  styles,
  colors,
}: {
  presets: DisplayPreset[];
  isLoading: boolean;
  onApply: (preset: DisplayPreset) => void;
  onLongPress: (preset: DisplayPreset) => void;
  styles: ReturnType<typeof createStyles>;
  colors: ReturnType<typeof useThemeColors>;
}) {
  const [hasMoreRight, setHasMoreRight] = useState(false);
  const contentW = useRef(0);
  const containerW = useRef(0);

  return (
    <View style={styles.chipsWrapper}>
      <GHScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipsContent}
        style={{ flex: 1 }}
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
        {presets.map((preset) => (
          <TouchableOpacity
            key={`${preset.source}-${preset.id}`}
            style={styles.chip}
            onPress={() => onApply(preset)}
            onLongPress={() => onLongPress(preset)}
            delayLongPress={300}
            activeOpacity={0.8}
          >
            <ThemedText style={styles.chipText} numberOfLines={1}>
              {preset.name}
            </ThemedText>
          </TouchableOpacity>
        ))}
        {!isLoading && presets.length === 0 && (
          <ThemedText style={styles.hintText}>
            Your saved presets will appear here
          </ThemedText>
        )}
      </GHScrollView>
      {hasMoreRight && (
        <View style={styles.scrollFadeRight} pointerEvents="none">
          <MaterialIcons name="chevron-right" size={16} color={colors.textSecondary} />
        </View>
      )}
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useThemeColors>) =>
  StyleSheet.create({
    // cards variant
    grid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginBottom: 10,
    },
    card: {
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
    cardRow: { flexDirection: "row", alignItems: "flex-start", gap: 4 },
    cardName: { flex: 1, fontSize: 13, fontWeight: "600", color: colors.text },
    cardDesc: { fontSize: 10, color: colors.textSecondary, lineHeight: 13 },
    // chips variant
    chipsWrapper: { flex: 1, position: "relative" },
    chipsContent: { gap: 8, alignItems: "center" },
    scrollFadeRight: {
      position: "absolute",
      right: 0,
      top: 0,
      bottom: 0,
      justifyContent: "center",
      paddingLeft: 4,
      backgroundColor: colors.background,
    },
    chip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: 13,
      paddingVertical: 7,
      borderRadius: 18,
      backgroundColor: colors.pillBackground,
    },
    chipText: { fontSize: 13, fontWeight: "500", color: colors.pillText },
    hintText: { fontSize: 12, color: colors.textSecondary },
  });
