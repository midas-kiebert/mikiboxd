/**
 * Intro page 2 — connect Letterboxd.
 *
 * Takes the username inline, exactly like `LetterboxdUsernameTip`, and offers
 * the honest way out: plenty of people don't use Letterboxd at all. Saying so
 * retires that tip for good, so the app never nags about a service the user has
 * already told it they don't have.
 *
 * The "where do I find it?" help is open rather than collapsed here — the page
 * has the room, and a first-time user is exactly who needs it.
 */
import { useCallback, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";

import IntroPageShell from "@/components/intro/IntroPageShell";
import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import { useSaveLetterboxdUsername } from "@/hooks/useSaveLetterboxdUsername";
import { dismissTipForever } from "@/utils/feature-tips";

export default function IntroLetterboxdPage({ onDone }: { onDone: () => void }) {
  // Read flow: local state and data hooks first, then handlers, then the JSX.
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const [username, setUsername] = useState("");
  const saveMutation = useSaveLetterboxdUsername();

  const trimmedUsername = username.trim();

  const handleSave = useCallback(() => {
    if (!trimmedUsername) return;
    saveMutation.mutate(trimmedUsername, { onSuccess: onDone });
  }, [onDone, saveMutation, trimmedUsername]);

  // Told once, never asked again — including by the feature tip that exists to
  // ask this very question.
  const handleNoLetterboxd = useCallback(() => {
    dismissTipForever("letterboxd-username");
    onDone();
  }, [onDone]);

  // Render/output using the state and handlers prepared above.
  return (
    <IntroPageShell
      icon="bookmark-added"
      title="Connect your Letterboxd"
      message="Filter showtimes down to your watchlist, or hide films you have already seen."
      primaryLabel="Save and continue"
      onPrimary={handleSave}
      isPrimaryDisabled={!trimmedUsername}
      isPrimaryBusy={saveMutation.isPending}
      secondaryLabel="I don't use Letterboxd"
      onSecondary={handleNoLetterboxd}
    >
      <View style={styles.field}>
        <ThemedText style={styles.fieldLabel}>Letterboxd username</ThemedText>
        <View style={styles.inputRow}>
          <ThemedText style={styles.prefix}>letterboxd.com/</ThemedText>
          <TextInput
            style={styles.input}
            value={username}
            onChangeText={setUsername}
            placeholder="username"
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={handleSave}
            editable={!saveMutation.isPending}
          />
        </View>
      </View>

      <View style={styles.helpPanel}>
        <ThemedText style={styles.helpTitle}>Where do I find my username?</ThemedText>
        <View style={styles.helpItem}>
          <ThemedText style={styles.helpItemTitle}>On the website</ThemedText>
          <ThemedText style={styles.helpItemText}>
            Open your profile and read the address bar. In letterboxd.com/yourname, your username is
            the part after the slash.
          </ThemedText>
        </View>
        <View style={styles.helpItem}>
          <ThemedText style={styles.helpItemTitle}>In the Letterboxd app</ThemedText>
          <ThemedText style={styles.helpItemText}>
            Open your profile and tap the three dots in the top right corner. Your username is the
            grayed out name.
          </ThemedText>
        </View>
      </View>
    </IntroPageShell>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    field: {
      gap: 6,
    },
    fieldLabel: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.textSecondary,
    },
    inputRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingLeft: 12,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      borderRadius: 12,
      backgroundColor: colors.cardBackground,
    },
    prefix: {
      // Same size as the input so the prefix and what is typed read as one URL.
      fontSize: 16,
      color: colors.textSecondary,
    },
    input: {
      flex: 1,
      // Butts straight up against the "letterboxd.com/" prefix, so the two read
      // as one URL. Android gives TextInput horizontal padding by default.
      paddingLeft: 0,
      paddingRight: 12,
      paddingVertical: 13,
      fontSize: 16,
      color: colors.text,
    },
    helpPanel: {
      gap: 12,
      marginTop: 18,
      padding: 14,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBackground,
    },
    helpTitle: {
      fontSize: 13,
      fontWeight: "700",
      color: colors.tint,
    },
    helpItem: {
      gap: 3,
    },
    helpItemTitle: {
      fontSize: 13,
      fontWeight: "700",
      color: colors.text,
    },
    helpItemText: {
      fontSize: 13,
      lineHeight: 19,
      color: colors.textSecondary,
    },
  });
