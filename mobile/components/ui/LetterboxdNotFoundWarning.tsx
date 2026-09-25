/**
 * "There is no Letterboxd account called …": shown under the username field
 * in the intro and in Settings when the backend got a 404 for the linked
 * name. Only for a definite 404 (`letterboxd_account_not_found`), never for a
 * lookup that merely failed. The field right above it is how it gets fixed.
 */
import { StyleSheet, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";

export default function LetterboxdNotFoundWarning({ username }: { username: string }) {
  const colors = useThemeColors();
  const styles = createStyles(colors);

  return (
    <View style={styles.box} accessibilityRole="alert">
      <MaterialIcons name="error-outline" size={18} color={colors.red.secondary} />
      <View style={styles.textBlock}>
        <ThemedText style={styles.title}>
          {`There is no Letterboxd account called "${username}"`}
        </ThemedText>
        <ThemedText style={styles.body}>
          Check the spelling and save it again. Your watchlist and avatar can&apos;t be
          loaded until it matches your account.
        </ThemedText>
      </View>
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useThemeColors>) =>
  StyleSheet.create({
    box: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 8,
      padding: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.red.border,
      backgroundColor: colors.red.primary,
    },
    textBlock: {
      flex: 1,
      gap: 2,
    },
    title: {
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "700",
      color: colors.red.secondary,
    },
    body: {
      fontSize: 12,
      lineHeight: 17,
      color: colors.red.secondary,
    },
  });
