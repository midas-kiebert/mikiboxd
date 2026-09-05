/**
 * The one call to action on an auth screen.
 *
 * The label is kept mounted underneath the spinner rather than swapped out for
 * it, so a button that starts working does not change width or height — swapping
 * a 90pt label for a 20pt ActivityIndicator resized the button on every tap.
 */
import { ActivityIndicator, StyleSheet, TouchableOpacity, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import { triggerSelectionHaptic } from "@/utils/long-press";

type AuthPrimaryButtonProps = {
  label: string;
  onPress: () => void;
  isBusy?: boolean;
  isDisabled?: boolean;
};

export default function AuthPrimaryButton({
  label,
  onPress,
  isBusy = false,
  isDisabled = false,
}: AuthPrimaryButtonProps) {
  const colors = useThemeColors();
  const styles = createStyles(colors);

  const handlePress = () => {
    if (isBusy || isDisabled) return;
    // Paints before the request starts, so the tap is acknowledged even when
    // the network takes a moment to answer.
    triggerSelectionHaptic();
    onPress();
  };

  return (
    <TouchableOpacity
      style={[styles.button, (isBusy || isDisabled) && styles.buttonDisabled]}
      onPress={handlePress}
      disabled={isBusy || isDisabled}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityState={{ disabled: isBusy || isDisabled, busy: isBusy }}
    >
      <ThemedText style={[styles.label, isBusy && styles.labelHidden]}>{label}</ThemedText>
      {isBusy ? (
        <View style={styles.spinnerOverlay}>
          <ActivityIndicator size="small" color={colors.pillActiveText} />
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    button: {
      minHeight: 48,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.tint,
    },
    buttonDisabled: {
      opacity: 0.55,
    },
    label: {
      fontSize: 16,
      fontWeight: "700",
      color: colors.pillActiveText,
    },
    // Kept in the layout so the button holds its size while it works.
    labelHidden: {
      opacity: 0,
    },
    spinnerOverlay: {
      ...StyleSheet.absoluteFill,
      alignItems: "center",
      justifyContent: "center",
    },
  });
