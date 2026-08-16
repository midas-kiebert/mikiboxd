/**
 * The way past the door.
 *
 * What's on at which cinema is public, and useful to someone who has no
 * intention of making an account yet — so the auth screens offer a way in
 * without one. Deliberately a plain, quiet link rather than a third button
 * competing with Apple/Google: it is the way out of the form for someone who
 * did not want a form, not a fourth way to sign in.
 *
 * Hidden when the user is already browsing as a guest, which is how they got
 * here: they pushed this screen from a feature that needs an account, and
 * "browse without an account" would offer them what they already have.
 */
import { StyleSheet, TouchableOpacity, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import { enterGuestMode, useIsGuest } from "@/utils/auth-session";
import { triggerSelectionHaptic } from "@/utils/long-press";

export default function BrowseWithoutAccountLink({ disabled }: { disabled?: boolean }) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const router = useRouter();
  const isGuest = useIsGuest();

  if (isGuest) return null;

  const startBrowsing = () => {
    triggerSelectionHaptic();
    // Announced and navigated in the same synchronous block, so React batches
    // them into one commit and the root layout's route guard never sees the
    // navigation without the status that permits it. Same contract as
    // `completeLogin`.
    enterGuestMode();
    router.replace("/(tabs)");
  };

  return (
    <TouchableOpacity
      onPress={startBrowsing}
      disabled={disabled}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel="Browse without an account"
      hitSlop={6}
    >
      <View style={styles.row}>
        <ThemedText style={styles.label}>Browse what&apos;s on without an account</ThemedText>
        <MaterialIcons name="arrow-forward" size={15} color={colors.tint} />
      </View>
    </TouchableOpacity>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 5,
      paddingVertical: 4,
    },
    label: {
      fontSize: 14,
      fontWeight: "700",
      color: colors.tint,
      textAlign: "center",
    },
  });
