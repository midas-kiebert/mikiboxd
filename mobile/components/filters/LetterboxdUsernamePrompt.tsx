/**
 * Stands in for the watchlist/watched filters when the user has no Letterboxd
 * username: a muted card saying what those filters would do, plus the one field
 * needed to switch them on.
 *
 * Deliberately quiet — it sits where real controls would be, so it explains
 * rather than nags. Saving invalidates `currentUser`, which flips
 * `canUseWatchlistFilter` and swaps this card for the actual filters.
 */
import { useCallback, useState } from "react";
import { ActivityIndicator, StyleSheet, TextInput, TouchableOpacity, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import { useSaveLetterboxdUsername } from "@/hooks/useSaveLetterboxdUsername";

export default function LetterboxdUsernamePrompt() {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const [username, setUsername] = useState("");
  const saveMutation = useSaveLetterboxdUsername();

  const trimmedUsername = username.trim();
  const canSave = trimmedUsername.length > 0 && !saveMutation.isPending;

  const handleSave = useCallback(() => {
    if (!trimmedUsername || saveMutation.isPending) return;
    saveMutation.mutate(trimmedUsername);
  }, [saveMutation, trimmedUsername]);

  return (
    <View style={styles.card}>
      <View style={styles.titleRow}>
        <MaterialIcons name="bookmark-added" size={16} color={colors.textSecondary} />
        <ThemedText style={styles.title}>Connect your Letterboxd</ThemedText>
      </View>
      <ThemedText style={styles.blurb}>
        Add your username to show only films on your watchlist, hide the ones you have already
        seen.
      </ThemedText>
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
      <TouchableOpacity
        style={[styles.saveButton, !canSave && styles.saveButtonDisabled]}
        onPress={handleSave}
        disabled={!canSave}
        activeOpacity={0.85}
        accessibilityRole="button"
      >
        {saveMutation.isPending ? (
          <ActivityIndicator size="small" color={colors.pillActiveText} />
        ) : (
          <ThemedText style={styles.saveButtonText}>Save username</ThemedText>
        )}
      </TouchableOpacity>
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useThemeColors>) =>
  StyleSheet.create({
    card: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.divider,
      backgroundColor: colors.cardBackground,
      paddingHorizontal: 12,
      paddingVertical: 12,
      marginBottom: 8,
      gap: 8,
    },
    titleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    title: { fontSize: 13, fontWeight: "600", color: colors.textSecondary },
    blurb: { fontSize: 12, lineHeight: 17, color: colors.textSecondary },
    inputRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingLeft: 10,
      borderWidth: 1,
      borderColor: colors.divider,
      borderRadius: 10,
      backgroundColor: colors.background,
    },
    // The prefix and the field share a size so the two read as one URL.
    prefix: { fontSize: 14, color: colors.textSecondary },
    input: {
      flex: 1,
      // Butts straight up against the prefix; Android gives TextInput its own
      // horizontal padding by default.
      paddingLeft: 0,
      paddingRight: 10,
      paddingVertical: 9,
      fontSize: 14,
      color: colors.text,
    },
    saveButton: {
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 9,
      borderRadius: 10,
      backgroundColor: colors.tint,
    },
    saveButtonDisabled: { opacity: 0.4 },
    saveButtonText: { fontSize: 13, fontWeight: "700", color: colors.pillActiveText },
  });
