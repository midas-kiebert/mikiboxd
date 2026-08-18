/**
 * What a guest sees instead of a tab that has nothing to show them.
 *
 * The account-only tabs stay in the tab bar rather than disappearing, so the
 * app has the same shape before and after signing in — and so a guest can find
 * out what an account is *for* by tapping one, instead of by guessing. This is
 * what they land on: the feature described in its own words, and the two ways
 * in, from the same copy table the intercepted-tap dialog reads.
 */
import { StyleSheet, TouchableOpacity, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";

import { ThemedText } from "@/components/themed-text";
import { ACCOUNT_FEATURE_COPY, type AccountFeature } from "@/components/auth/account-features";
import { useThemeColors } from "@/hooks/use-theme-color";
import { triggerSelectionHaptic } from "@/utils/long-press";

type SignedOutPanelProps = {
  feature: AccountFeature;
  /** Extra lines under the message, e.g. what this tab would list. */
  bullets?: readonly string[];
  /**
   * "screen" fills a whole tab that a guest cannot use. "card" is the same
   * offer sitting among other content that they *can* use — the top of
   * Settings, above the appearance and Cineville sections that work either way.
   */
  variant?: "screen" | "card";
};

export default function SignedOutPanel({
  feature,
  bullets,
  variant = "screen",
}: SignedOutPanelProps) {
  // Read flow: props/state setup first, then handlers, then the JSX.
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const router = useRouter();
  const copy = ACCOUNT_FEATURE_COPY[feature];

  const goToSignUp = () => {
    triggerSelectionHaptic();
    router.push("/signup");
  };

  const goToLogIn = () => {
    triggerSelectionHaptic();
    router.push("/login");
  };

  const isCard = variant === "card";

  return (
    <View style={isCard ? styles.card : styles.container}>
      <View
        style={[
          isCard ? styles.iconCircleSmall : styles.iconCircle,
          { backgroundColor: colors.surfaceMuted },
        ]}
      >
        <MaterialIcons name={copy.icon} size={isCard ? 22 : 30} color={colors.tint} />
      </View>
      <ThemedText style={styles.title}>{copy.title}</ThemedText>
      <ThemedText style={styles.message}>{copy.message}</ThemedText>
      {bullets && bullets.length > 0 ? (
        <View style={styles.bullets}>
          {bullets.map((bullet) => (
            <View key={bullet} style={styles.bulletRow}>
              <MaterialIcons name="check" size={15} color={colors.green.secondary} />
              <ThemedText style={styles.bulletText}>{bullet}</ThemedText>
            </View>
          ))}
        </View>
      ) : null}
      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.button, styles.primaryButton]}
          onPress={goToSignUp}
          activeOpacity={0.8}
          accessibilityRole="button"
        >
          <ThemedText style={[styles.primaryText, { color: colors.pillActiveText }]}>
            Create an account
          </ThemedText>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.button, styles.secondaryButton]}
          onPress={goToLogIn}
          activeOpacity={0.8}
          accessibilityRole="button"
        >
          <ThemedText style={styles.secondaryText}>I already have one</ThemedText>
        </TouchableOpacity>
      </View>
      {/* Says out loud that nothing has been taken away: the rest of the app
          keeps working exactly as it did a second ago. Only on the full-screen
          variant — in Settings the sections below it already say as much. */}
    </View>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    container: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 28,
      paddingBottom: 40,
      gap: 8,
    },
    card: {
      alignItems: "center",
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBackground,
      paddingHorizontal: 16,
      paddingVertical: 18,
      gap: 8,
    },
    iconCircle: {
      width: 60,
      height: 60,
      borderRadius: 30,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 6,
    },
    iconCircleSmall: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 2,
    },
    title: { fontSize: 20, fontWeight: "700", color: colors.text, textAlign: "center" },
    message: {
      fontSize: 14,
      lineHeight: 20,
      textAlign: "center",
      color: colors.textSecondary,
      maxWidth: 320,
    },
    bullets: { gap: 6, marginTop: 10, alignSelf: "stretch", maxWidth: 320 },
    bulletRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    bulletText: { fontSize: 13, lineHeight: 18, color: colors.textSecondary, flexShrink: 1 },
    actions: { alignSelf: "stretch", gap: 8, marginTop: 18, maxWidth: 320, width: "100%" },
    button: {
      minHeight: 46,
      borderRadius: 12,
      borderWidth: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    primaryButton: { backgroundColor: colors.tint, borderColor: colors.tint },
    primaryText: { fontSize: 15, fontWeight: "700" },
    secondaryButton: {
      backgroundColor: colors.pillBackground,
      borderColor: colors.cardBorder,
    },
    secondaryText: { fontSize: 15, fontWeight: "700", color: colors.text },
    footnote: {
      fontSize: 12,
      lineHeight: 16,
      color: colors.textSecondary,
      textAlign: "center",
      marginTop: 14,
      opacity: 0.85,
    },
  });
