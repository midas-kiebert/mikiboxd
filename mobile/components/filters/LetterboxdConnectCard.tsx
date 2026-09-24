/**
 * Stands in for the watchlist/watched filters when they cannot be used yet: no
 * Letterboxd username linked, or no account at all.
 *
 * Collapsed to one row by default. It sits where real filters would be, in a
 * sheet people open to filter, so it should say what is missing rather than
 * take over the sheet — the full sign-in card and the old always-open username
 * form were both taller than the filters they stood in for. Tapping the row
 * opens the one thing needed: the username field, or for a guest the two ways
 * into an account.
 *
 * Saving the username invalidates `currentUser`, which flips
 * `canUseWatchlistFilter` and swaps this card for the actual filters.
 */
import { useCallback, useState } from "react";
import { ActivityIndicator, StyleSheet, TextInput, TouchableOpacity, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";

import { ThemedText } from "@/components/themed-text";
import AnimatedHeight from "@/components/ui/AnimatedHeight";
import { SHEET_OPEN_DURATION_MS } from "@/components/sheets/sheet-timing";
import { useThemeColors } from "@/hooks/use-theme-color";
import { useSaveLetterboxdUsername } from "@/hooks/useSaveLetterboxdUsername";
import { useIsSignedIn } from "@/utils/auth-session";
import { triggerSelectionHaptic } from "@/utils/long-press";

type LetterboxdConnectCardProps = {
  /**
   * Closes the sheet this card sits in. Called before going to the log-in or
   * sign-up screen, so the sheet is not left open on top of it.
   */
  onLeave?: () => void;
};

export default function LetterboxdConnectCard({ onLeave }: LetterboxdConnectCardProps) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const router = useRouter();
  const isSignedIn = useIsSignedIn();
  const [isExpanded, setIsExpanded] = useState(false);
  const [username, setUsername] = useState("");
  const saveMutation = useSaveLetterboxdUsername();

  const trimmedUsername = username.trim();
  const canSave = trimmedUsername.length > 0 && !saveMutation.isPending;

  const handleSave = useCallback(() => {
    if (!trimmedUsername || saveMutation.isPending) return;
    saveMutation.mutate(trimmedUsername);
  }, [saveMutation, trimmedUsername]);

  const toggleExpanded = () => {
    triggerSelectionHaptic();
    setIsExpanded((current) => !current);
  };

  const goTo = (pathname: "/login" | "/signup") => {
    triggerSelectionHaptic();
    if (!onLeave) {
      router.push(pathname);
      return;
    }
    // The sheet lives above every screen, so pushing straight away slid the
    // log-in screen in underneath a sheet that was still open.
    onLeave();
    setTimeout(() => router.push(pathname), SHEET_OPEN_DURATION_MS);
  };

  return (
    <View style={styles.card}>
      <TouchableOpacity
        style={styles.header}
        onPress={toggleExpanded}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityState={{ expanded: isExpanded }}
        accessibilityLabel="Connect your Letterboxd"
      >
        <MaterialIcons name="bookmark-added" size={16} color={colors.textSecondary} />
        <View style={styles.headerText}>
          <ThemedText style={styles.title}>Connect your Letterboxd</ThemedText>
          <ThemedText style={styles.subtitle} numberOfLines={1}>
            Filter by your watchlist and what you have seen
          </ThemedText>
        </View>
        <MaterialIcons
          name={isExpanded ? "expand-less" : "expand-more"}
          size={20}
          color={colors.textSecondary}
        />
      </TouchableOpacity>

      <AnimatedHeight>
        {isExpanded ? (
          <View style={styles.body}>
            {isSignedIn ? (
              <>
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
                  style={[styles.primaryButton, !canSave && styles.buttonDisabled]}
                  onPress={handleSave}
                  disabled={!canSave}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                >
                  {saveMutation.isPending ? (
                    <ActivityIndicator size="small" color={colors.pillActiveText} />
                  ) : (
                    <ThemedText style={styles.primaryButtonText}>Save username</ThemedText>
                  )}
                </TouchableOpacity>
              </>
            ) : (
              <>
                <ThemedText style={styles.blurb}>
                  Your Letterboxd username goes on an account, so these filters need one.
                </ThemedText>
                <View style={styles.buttonRow}>
                  <TouchableOpacity
                    style={[styles.primaryButton, styles.buttonInRow]}
                    onPress={() => goTo("/signup")}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                  >
                    <ThemedText style={styles.primaryButtonText}>Create an account</ThemedText>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.secondaryButton, styles.buttonInRow]}
                    onPress={() => goTo("/login")}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                  >
                    <ThemedText style={styles.secondaryButtonText}>Log in</ThemedText>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        ) : null}
      </AnimatedHeight>
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
      marginBottom: 8,
      overflow: "hidden",
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    headerText: { flex: 1, minWidth: 0 },
    title: { fontSize: 13, fontWeight: "600", color: colors.text },
    subtitle: { fontSize: 12, color: colors.textSecondary },
    body: { paddingHorizontal: 12, paddingBottom: 12, gap: 8 },
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
    buttonRow: { flexDirection: "row", gap: 8 },
    buttonInRow: { flex: 1 },
    primaryButton: {
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 9,
      borderRadius: 10,
      backgroundColor: colors.tint,
    },
    buttonDisabled: { opacity: 0.4 },
    primaryButtonText: { fontSize: 13, fontWeight: "700", color: colors.pillActiveText },
    secondaryButton: {
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 9,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.pillBackground,
    },
    secondaryButtonText: { fontSize: 13, fontWeight: "700", color: colors.text },
  });
