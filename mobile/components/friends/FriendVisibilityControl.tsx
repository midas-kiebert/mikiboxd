/**
 * Per-friend control for who gets to see your showtime status. Renders the two
 * possible answers side by side ("Always" / "Only when invited") instead of a
 * single ambiguous on-off toggle, so the current setting is readable at a glance
 * without having to work out what the opposite state would be. The selected
 * answer carries a subtle tint — green for open, amber for restricted — so the
 * setting also reads from a scan down the list.
 *
 * The tint is one thumb that slides between the two answers and crosses from
 * green to amber on the way, rather than a background that jumps from one
 * segment to the other: `useSlidingThumb`, the same motion the app's other
 * segmented controls use. The shape is this control's own — squared corners on
 * a hairline white track, because it sits on the white of a friend row.
 */
import { useMemo, type ReactNode } from "react";
import { StyleSheet, TouchableOpacity, View, type GestureResponderEvent } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import Animated, { interpolateColor, useAnimatedStyle } from "react-native-reanimated";

import { ThemedText } from "@/components/themed-text";
import { useOptimisticValue } from "@/hooks/useOptimisticValue";
import { useThemeColors } from "@/hooks/use-theme-color";
import {
  useRestingCopyStyle,
  useSelectedCopyStyle,
  useSlidingThumb,
  type SlidingThumb,
} from "@/components/ui/use-sliding-thumb";
import { triggerSelectionHaptic } from "@/utils/long-press";

type FriendVisibilityControlProps = {
  /** True when this friend sees your status on every showtime, not just invites. */
  sharesStatus: boolean;
  onChange: (sharesStatus: boolean) => void;
  disabled?: boolean;
  /** Rendered at the end of the label line — a place for a rare, unrelated
   *  per-friend action (e.g. remove friend) to sit deliberately rather than
   *  floating loose beside the control. */
  trailingAccessory?: ReactNode;
};

type VisibilityOption = {
  sharesStatus: boolean;
  label: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  /** Palette key used to tint the option when it is the selected one. */
  tone: "green" | "orange";
  hint: string;
};

const OPTIONS: readonly VisibilityOption[] = [
  {
    sharesStatus: true,
    label: "Always",
    icon: "visibility",
    tone: "green",
    hint: "on every showtime you pick",
  },
  {
    sharesStatus: false,
    label: "Only when invited",
    icon: "lock-outline",
    tone: "orange",
    hint: "only on showtimes you invite them to",
  },
];

/** Interpolation stops for the thumb's colour: one per option. */
const OPTION_STOPS = OPTIONS.map((_, index) => index);

export default function FriendVisibilityControl({
  sharesStatus,
  onChange,
  disabled = false,
  trailingAccessory,
}: FriendVisibilityControlProps) {
  // Read flow: props/state setup first, then helper handlers, then returned JSX.
  const colors = useThemeColors();
  const styles = createStyles(colors);

  // The tint leaves on the tap rather than on the save that follows it.
  const { value: displaySharesStatus, change } = useOptimisticValue(sharesStatus, onChange);
  const selectedIndex = Math.max(
    0,
    OPTIONS.findIndex((option) => option.sharesStatus === displaySharesStatus)
  );
  const selectedOption = OPTIONS[selectedIndex];
  const selectedTone = colors[selectedOption.tone];

  const thumb = useSlidingThumb(selectedIndex);
  // Memoised because the thumb's animated style reads it: a fresh array each
  // render would rebuild the worklet's inputs on every render.
  const thumbColors = useMemo(() => OPTIONS.map((option) => colors[option.tone].primary), [colors]);
  const thumbStyle = useAnimatedStyle(() => ({
    opacity: thumb.thumbOpacity.value,
    width: thumb.thumbWidth.value,
    transform: [{ translateX: thumb.thumbX.value }],
    backgroundColor: interpolateColor(thumb.progress.value, OPTION_STOPS, thumbColors),
  }));

  const handleSelect = (event: GestureResponderEvent, index: number, next: boolean) => {
    event.stopPropagation();
    if (disabled || next === displaySharesStatus) return;
    triggerSelectionHaptic();
    // The tint leaves first, and from here rather than from a render: the save
    // this starts must not be able to hold up the travel.
    thumb.moveTo(index);
    change(next);
  };

  // Render/output using the state and derived values prepared above.
  return (
    <View style={styles.container}>
      <View style={styles.labelRow}>
        <View style={styles.labelText}>
          <MaterialIcons name={selectedOption.icon} size={13} color={selectedTone.secondary} />
          <ThemedText style={styles.label}>Can see your showtimes:</ThemedText>
        </View>
        {trailingAccessory}
      </View>
      <View
        style={[styles.track, disabled && styles.trackDisabled]}
        accessibilityRole="radiogroup"
        accessibilityLabel="Who can see your showtimes"
      >
        {/* The thumb travels against this inner row, which carries none of the
            track's padding, so a segment's measured x is the thumb's x. */}
        <View style={styles.inner}>
          <Animated.View style={[styles.thumb, thumbStyle]} pointerEvents="none" />
          {OPTIONS.map((option, index) => (
            <Segment
              key={option.label}
              option={option}
              index={index}
              thumb={thumb}
              selectedForeground={colors[option.tone].secondary}
              styles={styles}
              disabled={disabled}
              isSelected={index === selectedIndex}
              onPress={(event) => handleSelect(event, index, option.sharesStatus)}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

type SegmentProps = {
  option: VisibilityOption;
  index: number;
  thumb: SlidingThumb;
  selectedForeground: string;
  styles: ReturnType<typeof createStyles>;
  disabled: boolean;
  isSelected: boolean;
  onPress: (event: GestureResponderEvent) => void;
};

function Segment({
  option,
  index,
  thumb,
  selectedForeground,
  styles,
  disabled,
  isSelected,
  onPress,
}: SegmentProps) {
  // The selected copy is bolder than the resting one, so it cannot simply be
  // laid over it — the two fade past each other instead.
  const restingCopyStyle = useRestingCopyStyle(thumb, index);
  const selectedCopyStyle = useSelectedCopyStyle(thumb, index);

  return (
    <TouchableOpacity
      style={styles.segment}
      onLayout={(event) => thumb.onSegmentLayout(index, event)}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.8}
      accessibilityRole="radio"
      accessibilityState={{ selected: isSelected, disabled }}
      accessibilityLabel={`${option.label} — ${option.hint}`}
    >
      <Animated.View style={restingCopyStyle}>
        <ThemedText style={styles.segmentText} numberOfLines={1}>
          {option.label}
        </ThemedText>
      </Animated.View>
      {/* Laid over the resting copy, in the same content box, so the two are
          measured and truncated identically. */}
      <Animated.View style={[styles.selectedCopy, selectedCopyStyle]} pointerEvents="none">
        <ThemedText
          style={[styles.segmentText, styles.segmentTextSelected, { color: selectedForeground }]}
          numberOfLines={1}
        >
          {option.label}
        </ThemedText>
      </Animated.View>
    </TouchableOpacity>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    container: {
      gap: 4,
    },
    labelRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    labelText: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
    },
    label: {
      fontSize: 11,
      fontWeight: "600",
      letterSpacing: 0.2,
      color: colors.textSecondary,
    },
    track: {
      flexDirection: "row",
      alignItems: "stretch",
      borderRadius: 10,
      // A hairline-defined white track rather than the surfaceMuted fill: this
      // control usually sits on a white row, where surfaceMuted read as a dark slab.
      backgroundColor: colors.cardBackground,
      borderWidth: 1,
      borderColor: colors.pillBorder,
      padding: 3,
    },
    trackDisabled: {
      opacity: 0.5,
    },
    inner: {
      flex: 1,
      flexDirection: "row",
      alignItems: "stretch",
      gap: 3,
    },
    thumb: {
      position: "absolute",
      top: 0,
      bottom: 0,
      left: 0,
      borderRadius: 8,
      shadowColor: "#000",
      shadowOpacity: 0.08,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 1 },
      elevation: 1,
    },
    segment: {
      flex: 1,
      minHeight: 28,
      borderRadius: 8,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 6,
    },
    selectedCopy: {
      ...StyleSheet.absoluteFill,
      alignItems: "center",
      justifyContent: "center",
    },
    segmentText: {
      fontSize: 12,
      fontWeight: "600",
      color: colors.textSecondary,
    },
    segmentTextSelected: {
      fontWeight: "700",
    },
  });
