/**
 * A compact segmented control: one pill-shaped track with the selected option
 * as a filled thumb that slides between the segments.
 *
 * Sized to sit at the right-hand end of a settings/filter row, so a whole
 * either/or choice costs one line instead of a wrapping row of loose pills.
 * An option can carry its own thumb colors, which is how a "neutral" default
 * (an unfiltered "Any", a notification set to "Off") avoids reading as
 * switched on while the real choices keep the app's status colors.
 *
 * The thumb is one absolutely positioned view rather than a background on the
 * selected segment, so a change is a travel rather than a jump: it slides and
 * resizes to the segment it is going to, and its colour crosses over on the
 * way when the two segments do not share one. The segments themselves are
 * measured, not assumed equal — labels differ in width unless `stretch` is on.
 *
 * Each segment carries two copies of its content, one in the resting colour and
 * one in the selected colour stacked on top, crossfading as the thumb arrives.
 * The measuring and the motion are `useSlidingThumb`, shared with the other
 * segmented control in the app.
 *
 * The travel starts on the tap and not on the answer (`useOptimisticValue`):
 * `onChange` here re-themes the whole app, or waits on a save, and a control
 * that only moves once that has landed reads as a control that missed the tap.
 */
import { useMemo } from "react";
import { StyleSheet, TouchableOpacity, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  type SharedValue,
} from "react-native-reanimated";

import { ThemedText } from "@/components/themed-text";
import { useOptimisticValue } from "@/hooks/useOptimisticValue";
import { useThemeColors } from "@/hooks/use-theme-color";
import {
  useSelectedCopyStyle,
  useSlidingThumb,
  type SlidingThumb,
} from "@/components/ui/use-sliding-thumb";
import { triggerSelectionHaptic } from "@/utils/long-press";

export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  icon?: keyof typeof MaterialIcons.glyphMap;
  /** Thumb color when selected; defaults to the app tint. */
  activeBackground?: string;
  /** Label/icon color when selected; defaults to the app tint's text color. */
  activeForeground?: string;
};

type Props<T extends string> = {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Prefixes each option's accessibility label, e.g. "Group by". */
  accessibilityLabelPrefix?: string;
  /**
   * Split the available width evenly between the options instead of sizing to
   * the labels. For a control that is the whole width of a screen rather than
   * the right-hand end of a row.
   */
  stretch?: boolean;
  /**
   * "compact" (default) is the settings/filter-row size, tuned to share one
   * line with a label on a 375pt screen. "large" is for a control that leads a
   * screen, where the segments are the primary navigation and need a real
   * touch target.
   */
  size?: "compact" | "large";
  /** Blocks every segment, e.g. while a save is in flight. */
  disabled?: boolean;
  /**
   * For a control that labels a pager: the pager's own continuous page position
   * (fractional mid-drag). The thumb then follows the pages rather than being
   * sent to a segment — it tracks the finger, and it never waits on the render
   * that committing a page change sets off. The press handler stands down with
   * it, since moving the pages is what moves the thumb.
   */
  progress?: SharedValue<number>;
};

type Styles = ReturnType<typeof createStyles>;

export default function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabelPrefix,
  stretch = false,
  size = "compact",
  disabled = false,
  progress,
}: Props<T>) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const isLarge = size === "large";

  // The selection paints on the tap, not on the answer: `onChange` can re-theme
  // the whole app or wait on a save, and neither is something a control may
  // make the user watch for before it acknowledges the press. The thumb's own
  // travel does not even wait for this — see `moveTo` in the press handler.
  const { value: displayValue, change } = useOptimisticValue(value, onChange);
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === displayValue)
  );

  const thumb = useSlidingThumb(selectedIndex, progress);

  // Memoised because the thumb's animated style reads them: a fresh array each
  // render would rebuild the worklet's inputs on every render.
  const thumbColors = useMemo(
    () => options.map((option) => option.activeBackground ?? colors.pillActiveBackground),
    [options, colors.pillActiveBackground]
  );
  const thumbColorStops = useMemo(() => thumbColors.map((_, index) => index), [thumbColors]);
  const thumbStyle = useAnimatedStyle(() => ({
    opacity: thumb.thumbOpacity.value,
    width: thumb.thumbWidth.value,
    transform: [{ translateX: thumb.thumbX.value }],
    backgroundColor:
      thumbColors.length > 1
        ? interpolateColor(thumb.progress.value, thumbColorStops, thumbColors)
        : thumbColors[0],
  }));

  return (
    <View style={[styles.track, stretch && styles.trackStretch]}>
      {/* The thumb is positioned against this inner row, which carries no
          padding of its own, so a segment's measured x is the thumb's x. */}
      <View style={[styles.inner, stretch && styles.innerStretch]}>
        <Animated.View style={[styles.thumb, thumbStyle]} pointerEvents="none" />
        {options.map((option, index) => (
          <Segment
            key={option.value}
            option={option}
            index={index}
            thumb={thumb}
            colors={colors}
            styles={styles}
            isLarge={isLarge}
            stretch={stretch}
            disabled={disabled}
            isSelected={index === selectedIndex}
            accessibilityLabel={
              accessibilityLabelPrefix
                ? `${accessibilityLabelPrefix}: ${option.label}`
                : option.label
            }
            onPress={() => {
              triggerSelectionHaptic();
              // The thumb leaves first, and from here rather than from a
              // render: whatever `change` sets off must not be able to hold it.
              // With a pager driving it there is nothing to send — the pages
              // carry the thumb, and `onChange` is what starts them moving.
              if (progress === undefined) thumb.moveTo(index);
              change(option.value);
            }}
          />
        ))}
      </View>
    </View>
  );
}

type SegmentProps<T extends string> = {
  option: SegmentedOption<T>;
  index: number;
  thumb: SlidingThumb;
  colors: ReturnType<typeof useThemeColors>;
  styles: Styles;
  isLarge: boolean;
  stretch: boolean;
  disabled: boolean;
  isSelected: boolean;
  accessibilityLabel: string;
  onPress: () => void;
};

function Segment<T extends string>({
  option,
  index,
  thumb,
  colors,
  styles,
  isLarge,
  stretch,
  disabled,
  isSelected,
  accessibilityLabel,
  onPress,
}: SegmentProps<T>) {
  const selectedCopyStyle = useSelectedCopyStyle(thumb, index);

  const renderContent = (color: string) => (
    <>
      {option.icon && (
        <MaterialIcons name={option.icon} size={isLarge ? 16 : 12} color={color} />
      )}
      <ThemedText
        style={[styles.segmentText, isLarge && styles.segmentTextLarge, { color }]}
        numberOfLines={1}
      >
        {option.label}
      </ThemedText>
    </>
  );

  return (
    <TouchableOpacity
      style={[styles.segment, isLarge && styles.segmentLarge, stretch && styles.segmentStretch]}
      onLayout={(event) => thumb.onSegmentLayout(index, event)}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityState={{ selected: isSelected, disabled }}
      accessibilityLabel={accessibilityLabel}
    >
      {renderContent(colors.pillText)}
      {/* Laid over the resting copy, in the same content box, so the two are
          measured and truncated identically. */}
      <Animated.View
        style={[styles.selectedCopy, isLarge && styles.selectedCopyLarge, selectedCopyStyle]}
        pointerEvents="none"
      >
        {renderContent(option.activeForeground ?? colors.pillActiveText)}
      </Animated.View>
    </TouchableOpacity>
  );
}

const createStyles = (colors: ReturnType<typeof useThemeColors>) =>
  StyleSheet.create({
    track: {
      flexDirection: "row",
      alignItems: "center",
      borderRadius: 999,
      backgroundColor: colors.surfaceMuted,
      padding: 2,
    },
    trackStretch: {
      alignSelf: "stretch",
    },
    inner: {
      flexDirection: "row",
      alignItems: "center",
    },
    innerStretch: {
      flex: 1,
    },
    thumb: {
      position: "absolute",
      top: 0,
      bottom: 0,
      left: 0,
      borderRadius: 999,
    },
    // Deliberately tight: the widest control (Any / Interested / Going, with
    // icons) has to share one line with its row label on a 375pt screen.
    segment: {
      flexDirection: "row",
      alignItems: "center",
      gap: 3,
      paddingHorizontal: 8,
      paddingVertical: 5,
      borderRadius: 999,
    },
    segmentLarge: {
      gap: 6,
      paddingHorizontal: 14,
      paddingVertical: 9,
    },
    // Equal shares of the track, so two segments read as one control rather
    // than two pills that happen to be next to each other.
    segmentStretch: {
      flex: 1,
      justifyContent: "center",
    },
    // Absolute inside the segment, so it fills exactly the segment's content
    // box and needs no padding of its own to line up with the copy beneath.
    selectedCopy: {
      ...StyleSheet.absoluteFillObject,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 3,
    },
    selectedCopyLarge: {
      gap: 6,
    },
    segmentText: { fontSize: 11, fontWeight: "700" },
    segmentTextLarge: { fontSize: 14 },
  });
