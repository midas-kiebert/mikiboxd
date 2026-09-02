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
import { useDisplayPresets } from "@/components/filters/useDisplayPresets";
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

/**
 * The collapsed "no presets yet" line. Bigger than the caption it replaces,
 * and capped at the height of the info icon it sits beside so the row keeps
 * the caption row's height.
 */
const EMPTY_HINT_FONT_SIZE = 11;
const EMPTY_HINT_LINE_HEIGHT = 13;

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
  // Read here as well as in the row below — one react-query cache entry, so
  // this is the same fetch — because with nothing saved there is no row to
  // caption, and the whole thing collapses to a single line.
  const { presets, isLoading } = useDisplayPresets({ enabled: isSignedIn });
  const [isTipVisible, setIsTipVisible] = useState(false);

  const openTip = () => {
    triggerSelectionHaptic();
    setIsTipVisible(true);
  };

  if (!isSignedIn) return null;

  // Held back while the first fetch is out: the buttons' skeletons say the row
  // is loading, and collapsing to the hint only to expand again a moment later
  // would be a jump for anyone who does have presets.
  const isEmpty = !isLoading && presets.length === 0;

  // One container with fixed child slots rather than two returns: the tip below
  // has to keep its place in the tree. Saving the first preset flips `isEmpty`,
  // and a tip that changed position would be torn down and remounted mid-use —
  // losing what the user had just added.
  return (
    <View style={[styles.container, isEmpty && styles.containerEmpty]}>
      {isEmpty ? (
        // Nothing saved: one caption-height line inviting the user to make a
        // preset, tappable across its whole width, in place of a caption over
        // an empty row.
        <TouchableOpacity
          style={styles.captionRow}
          onPress={openTip}
          hitSlop={10}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="What are saved presets?"
        >
          <ThemedText style={[styles.caption, styles.captionSentence]}>
            You can add Filter Presets here
          </ThemedText>
          <MaterialIcons name="info-outline" size={13} color={colors.textSecondary} />
        </TouchableOpacity>
      ) : (
        <View style={[styles.captionRow, styles.captionRowSpaced]}>
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
      )}
      {isEmpty ? null : <SavedPresetChips onApply={onApplyPreset} />}
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
    // Without the scroller under it there is no pop headroom to trim against,
    // so the row carries its padding whole.
    containerEmpty: {
      paddingTop: ROW_PADDING_TOP,
      paddingBottom: ROW_PADDING_BOTTOM,
    },
    captionRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      marginLeft: PRESETS_ROW_INSET,
      // Room to the right of the text, so the tap target of the collapsed row
      // stops before the screen edge instead of running under it.
      marginRight: PRESETS_ROW_INSET,
    },
    // Only when something follows it — the collapsed row is the last thing in
    // its container and the padding below is already its own.
    captionRowSpaced: {
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
    // A sentence, not a heading: the caps and the tracking that opens them up
    // both belong to the one-word caption, not to this. A couple of points
    // bigger with it, since it has to read as a line rather than as a label —
    // the line height stays under the info icon beside it, so the row is no
    // taller than the caption row it stands in for.
    captionSentence: {
      fontSize: EMPTY_HINT_FONT_SIZE,
      lineHeight: EMPTY_HINT_LINE_HEIGHT,
      textTransform: "none",
      letterSpacing: 0,
    },
  });
