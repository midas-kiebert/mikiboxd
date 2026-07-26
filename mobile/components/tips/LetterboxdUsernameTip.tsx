/**
 * Feature tip: the user has no Letterboxd username, so the watchlist and
 * already seen filters do nothing for them. Takes the username inline, since
 * sending someone to Settings for a single text field is a poor trade.
 *
 * Eligibility lives in `FeatureTipsHost`; this component renders and saves.
 */
import { useCallback, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";

import FeatureTipModal from "@/components/tips/FeatureTipModal";
import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import { useSaveLetterboxdUsername } from "@/hooks/useSaveLetterboxdUsername";
import { useDismissTip } from "@/utils/feature-tips";

export default function LetterboxdUsernameTip() {
  // Read flow: local state and data hooks first, then handlers, then the JSX.
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const dismissTip = useDismissTip("letterboxd-username");
  const [username, setUsername] = useState("");
  // Saving normally makes the tip ineligible, but the confirmation is shown
  // anyway so the dialog never disappears the moment the user presses save.
  const [savedUsername, setSavedUsername] = useState<string | null>(null);

  const saveMutation = useSaveLetterboxdUsername();

  const trimmedUsername = username.trim();

  const handleSave = useCallback(() => {
    if (!trimmedUsername) return;
    saveMutation.mutate(trimmedUsername, {
      onSuccess: () => setSavedUsername(trimmedUsername),
    });
  }, [saveMutation, trimmedUsername]);

  // Render/output using the state and handlers prepared above.
  if (savedUsername) {
    return (
      <FeatureTipModal
        tipId="letterboxd-username"
        icon="check-circle"
        title="Letterboxd username saved"
        message="Your watchlist will sync shortly. After that you can filter showtimes down to your watchlist, or hide films you have already seen."
        actionLabel="Done"
        closeOnAction
        onDismiss={dismissTip}
      />
    );
  }

  return (
    <FeatureTipModal
      tipId="letterboxd-username"
      icon="bookmark-added"
      title="Connect your Letterboxd watchlist"
      message="Add your Letterboxd username to MiKiNO to use your watchlist as a filter, or to hide films you have already seen."
      actionLabel="Save username"
      onAction={handleSave}
      isActionDisabled={!trimmedUsername}
      isActionBusy={saveMutation.isPending}
      onDismiss={dismissTip}
      helpLabel="Where do I find my username?"
      helpContent={
        <>
          <View style={styles.helpItem}>
            <ThemedText style={styles.helpItemTitle}>On the website</ThemedText>
            <ThemedText style={styles.helpItemText}>
              Open your profile and read the address bar. In letterboxd.com/yourname, your username
              is the part after the slash.
            </ThemedText>
          </View>
          <View style={styles.helpItem}>
            <ThemedText style={styles.helpItemTitle}>In the Letterboxd app</ThemedText>
            <ThemedText style={styles.helpItemText}>
              Open your profile and tap the three dots in the top right corner. Your username is the
              grayed out name.
            </ThemedText>
          </View>
        </>
      }
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
    </FeatureTipModal>
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
      backgroundColor: colors.background,
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
