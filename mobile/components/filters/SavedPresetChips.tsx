import { useMemo, useRef, useState } from "react";
import { Alert, StyleSheet, TouchableOpacity, View } from "react-native";
import { ScrollView as GHScrollView } from "react-native-gesture-handler";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import { type DisplayPreset } from "@/components/filters/saved-presets";
import { useDisplayPresets } from "@/components/filters/useDisplayPresets";
import { Skeleton } from "@/components/ui/Skeleton";
import FilterPresetTip from "@/components/tips/FilterPresetTip";
import { triggerSelectionHaptic } from "@/utils/long-press";
import useTrackEvent from "shared/hooks/useTrackEvent";

/** Placeholder pill widths shown while presets load. */
const SKELETON_CHIP_WIDTHS = [78, 96, 64];

type SavedPresetChipsProps = {
  onApply: (preset: DisplayPreset) => void;
};

export default function SavedPresetChips({ onApply }: SavedPresetChipsProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { presets, isLoading, remove } = useDisplayPresets();
  const { trackEvent } = useTrackEvent();
  const [isTipVisible, setIsTipVisible] = useState(false);

  const handleApply = (preset: DisplayPreset) => {
    triggerSelectionHaptic();
    trackEvent("preset_used");
    onApply(preset);
  };

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

  const handleOpenTip = () => {
    triggerSelectionHaptic();
    setIsTipVisible(true);
  };

  return (
    <>
      <ChipsScroll
        presets={presets}
        isLoading={isLoading}
        onApply={handleApply}
        onLongPress={confirmDelete}
        onOpenTip={handleOpenTip}
        styles={styles}
        colors={colors}
      />
      {isTipVisible ? (
        <FilterPresetTip isPreview onClose={() => setIsTipVisible(false)} />
      ) : null}
    </>
  );
}

function ChipsScroll({
  presets,
  isLoading,
  onApply,
  onLongPress,
  onOpenTip,
  styles,
  colors,
}: {
  presets: DisplayPreset[];
  isLoading: boolean;
  onApply: (preset: DisplayPreset) => void;
  onLongPress: (preset: DisplayPreset) => void;
  onOpenTip: () => void;
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
        {isLoading &&
          presets.length === 0 &&
          SKELETON_CHIP_WIDTHS.map((width, i) => (
            <Skeleton key={`skeleton-${i}`} style={[styles.chipSkeleton, { width }]} />
          ))}
        {presets.map((preset) => (
          <TouchableOpacity
            key={preset.id}
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
          <TouchableOpacity
            style={styles.hintRow}
            onPress={onOpenTip}
            hitSlop={8}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="What are saved presets?"
          >
            <ThemedText style={styles.hintText}>
              Your saved presets will appear here
            </ThemedText>
            <MaterialIcons name="info-outline" size={14} color={colors.textSecondary} />
          </TouchableOpacity>
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
    chipsWrapper: { flex: 1, position: "relative" },
    chipsContent: { gap: 8, alignItems: "center", paddingRight: 16 },
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
      borderWidth: 1,
      borderColor: colors.pillBorder,
    },
    chipText: { fontSize: 13, fontWeight: "500", color: colors.pillText },
    chipSkeleton: {
      // Matches the loaded chip: 7pt padding either side of a 13pt line, plus the
      // 1pt hairline the outlined chip now carries.
      height: 32,
      borderRadius: 18,
      backgroundColor: colors.posterPlaceholder,
    },
    hintRow: { flexDirection: "row", alignItems: "center", gap: 5 },
    hintText: { fontSize: 12, color: colors.textSecondary },
  });
