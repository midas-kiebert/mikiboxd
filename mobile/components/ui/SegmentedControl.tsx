/**
 * A compact segmented control: one pill-shaped track with the selected option
 * as a filled thumb.
 *
 * Sized to sit at the right-hand end of a settings/filter row, so a whole
 * either/or choice costs one line instead of a wrapping row of loose pills.
 * An option can carry its own thumb colors, which is how a "neutral" default
 * (an unfiltered "Any") avoids reading as switched on while the real choices
 * keep the app's status colors.
 */
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { StyleSheet, TouchableOpacity, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
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
};

export default function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabelPrefix,
  stretch = false,
  size = "compact",
}: Props<T>) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const isLarge = size === "large";

  return (
    <View style={[styles.track, stretch && styles.trackStretch]}>
      {options.map((option) => {
        const isActive = option.value === value;
        const foreground = isActive
          ? (option.activeForeground ?? colors.pillActiveText)
          : colors.pillText;
        return (
          <TouchableOpacity
            key={option.value}
            style={[
              styles.segment,
              isLarge && styles.segmentLarge,
              stretch && styles.segmentStretch,
              isActive && {
                backgroundColor: option.activeBackground ?? colors.pillActiveBackground,
              },
            ]}
            onPress={() => {
              triggerSelectionHaptic();
              onChange(option.value);
            }}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={
              accessibilityLabelPrefix
                ? `${accessibilityLabelPrefix}: ${option.label}`
                : option.label
            }
          >
            {option.icon && (
              <MaterialIcons name={option.icon} size={isLarge ? 16 : 12} color={foreground} />
            )}
            <ThemedText
              style={[styles.segmentText, isLarge && styles.segmentTextLarge, { color: foreground }]}
              numberOfLines={1}
            >
              {option.label}
            </ThemedText>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useThemeColors>) =>
  StyleSheet.create({
    track: {
      flexDirection: "row",
      alignItems: "center",
      borderRadius: 999,
      backgroundColor: colors.pillBackground,
      padding: 2,
    },
    trackStretch: {
      alignSelf: "stretch",
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
    segmentText: { fontSize: 11, fontWeight: "700" },
    segmentTextLarge: { fontSize: 14 },
  });
