/**
 * Per-friend control for who gets to see your showtime status. Renders the two
 * possible answers side by side ("Always" / "Only when invited") instead of a
 * single ambiguous on-off toggle, so the current setting is readable at a glance
 * without having to work out what the opposite state would be. The selected
 * answer carries a subtle tint — green for open, amber for restricted — so the
 * setting also reads from a scan down the list.
 */
import { StyleSheet, TouchableOpacity, View, type GestureResponderEvent } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import { triggerSelectionHaptic } from "@/utils/long-press";

type FriendVisibilityControlProps = {
  /** True when this friend sees your status on every showtime, not just invites. */
  sharesStatus: boolean;
  onChange: (sharesStatus: boolean) => void;
  disabled?: boolean;
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

export default function FriendVisibilityControl({
  sharesStatus,
  onChange,
  disabled = false,
}: FriendVisibilityControlProps) {
  // Read flow: props/state setup first, then helper handlers, then returned JSX.
  const colors = useThemeColors();
  const styles = createStyles(colors);

  const selectedOption =
    OPTIONS.find((option) => option.sharesStatus === sharesStatus) ?? OPTIONS[0];
  const selectedTone = colors[selectedOption.tone];

  const handleSelect = (event: GestureResponderEvent, next: boolean) => {
    event.stopPropagation();
    if (disabled || next === sharesStatus) return;
    triggerSelectionHaptic();
    onChange(next);
  };

  // Render/output using the state and derived values prepared above.
  return (
    <View style={styles.container}>
      <View style={styles.labelRow}>
        <MaterialIcons name={selectedOption.icon} size={13} color={selectedTone.secondary} />
        <ThemedText style={styles.label}>Can see your showtimes:</ThemedText>
      </View>
      <View
        style={[styles.track, disabled && styles.trackDisabled]}
        accessibilityRole="radiogroup"
        accessibilityLabel="Who can see your showtimes"
      >
        {OPTIONS.map((option) => {
          const isSelected = option.sharesStatus === sharesStatus;
          const tone = colors[option.tone];
          return (
            <TouchableOpacity
              key={option.label}
              style={[
                styles.segment,
                isSelected && styles.segmentSelected,
                isSelected && { backgroundColor: tone.primary },
              ]}
              onPress={(event) => handleSelect(event, option.sharesStatus)}
              disabled={disabled}
              activeOpacity={0.8}
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected, disabled }}
              accessibilityLabel={`${option.label} — ${option.hint}`}
            >
              <ThemedText
                style={[
                  styles.segmentText,
                  isSelected && styles.segmentTextSelected,
                  isSelected && { color: tone.secondary },
                ]}
                numberOfLines={1}
              >
                {option.label}
              </ThemedText>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    container: {
      gap: 6,
    },
    labelRow: {
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
      backgroundColor: colors.pillBackground,
      padding: 3,
      gap: 3,
    },
    trackDisabled: {
      opacity: 0.5,
    },
    segment: {
      flex: 1,
      minHeight: 28,
      borderRadius: 8,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 6,
    },
    segmentSelected: {
      shadowColor: "#000",
      shadowOpacity: 0.08,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 1 },
      elevation: 1,
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
