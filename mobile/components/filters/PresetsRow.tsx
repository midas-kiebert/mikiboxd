/**
 * Mobile filter UI component: Presets Row.
 * A captioned, scrollable row of the user's saved-preset buttons.
 *
 * The buttons are actions, not selectors: tapping one applies its selections
 * and leaves everything else unchanged. Since a preset carries a name the user
 * chose, the label can never say what these are — the caption above the row
 * does that, and the squared corners separate them from the fully-rounded
 * pills and chips that hold state.
 *
 * The Filters button used to be pinned to the left of this row, which left the
 * caption heading only half of it. It lives beside the search field now, so
 * the caption heads a row that is entirely presets.
 */
import { useState } from "react";
import { StyleSheet, TouchableOpacity, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import SavedPresetChips from "@/components/filters/SavedPresetChips";
import { type DisplayPreset } from "@/components/filters/saved-presets";
import {
  PRESET_BUTTON_POP_HEADROOM,
  PRESETS_CAPTION_FONT_SIZE,
  PRESETS_CAPTION_GAP,
  PRESETS_CAPTION_LINE_HEIGHT,
  PRESETS_ROW_INSET,
} from "@/components/filters/filter-control-metrics";
import FilterPresetTip from "@/components/tips/FilterPresetTip";
import { useIsSignedIn } from "@/utils/auth-session";
import { triggerSelectionHaptic } from "@/utils/long-press";

/** Trimmed against the search bar's own bottom padding, unlike the bottom. */
const ROW_PADDING_TOP = 4;
const ROW_PADDING_BOTTOM = 10;

export type PresetsRowProps = {
  onApplyPreset: (preset: DisplayPreset) => void;
};

export default function PresetsRow({ onApplyPreset }: PresetsRowProps) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  // Presets belong to an account. A guest has none and no way to make one, so
  // the row is absent rather than empty — a caption over a hint they cannot act
  // on is worse than the space it would take.
  const isSignedIn = useIsSignedIn();
  const [isTipVisible, setIsTipVisible] = useState(false);

  const openTip = () => {
    triggerSelectionHaptic();
    setIsTipVisible(true);
  };

  if (!isSignedIn) return null;

  return (
    <View style={styles.container}>
      <View style={styles.captionRow}>
        <ThemedText style={styles.caption}>Presets</ThemedText>
        {/* What a preset is takes a paragraph to explain, and the caption has
            room for a word — so the explanation stays one tap away. */}
        <TouchableOpacity
          onPress={openTip}
          hitSlop={10}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="What are saved presets?"
        >
          <MaterialIcons name="info-outline" size={13} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>
      <SavedPresetChips onApply={onApplyPreset} onOpenTip={openTip} />
      {isTipVisible ? (
        <FilterPresetTip isPreview onClose={() => setIsTipVisible(false)} />
      ) : null}
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useThemeColors>) =>
  StyleSheet.create({
    container: {
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
      backgroundColor: colors.background,
      // No left inset and reduced padding: the scroller below carries both
      // itself, as headroom for the buttons' pop. What the row looks like is
      // unchanged — the space just belongs to the scroller now.
      paddingTop: ROW_PADDING_TOP - PRESET_BUTTON_POP_HEADROOM,
      paddingBottom: ROW_PADDING_BOTTOM - PRESET_BUTTON_POP_HEADROOM,
    },
    captionRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      marginLeft: PRESETS_ROW_INSET,
      marginBottom: PRESETS_CAPTION_GAP - PRESET_BUTTON_POP_HEADROOM,
    },
    caption: {
      fontSize: PRESETS_CAPTION_FONT_SIZE,
      // ThemedText's default type sets a 24pt line height that survives the
      // font size override, which would push the buttons far down the row.
      lineHeight: PRESETS_CAPTION_LINE_HEIGHT,
      fontWeight: "600",
      letterSpacing: 0.8,
      textTransform: "uppercase",
      color: colors.textSecondary,
    },
  });
