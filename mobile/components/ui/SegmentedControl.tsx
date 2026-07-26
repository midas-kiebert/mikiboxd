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
};

export default function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabelPrefix,
}: Props<T>) {
  const colors = useThemeColors();
  const styles = createStyles(colors);

  return (
    <View style={styles.track}>
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
              <MaterialIcons name={option.icon} size={12} color={foreground} />
            )}
            <ThemedText style={[styles.segmentText, { color: foreground }]} numberOfLines={1}>
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
    segmentText: { fontSize: 11, fontWeight: "700" },
  });
