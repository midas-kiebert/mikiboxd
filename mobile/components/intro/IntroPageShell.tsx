/**
 * The shell every full-screen intro page renders inside: icon, title, a short
 * explanation, the page's own content, and the footer that moves the intro on.
 *
 * Purely presentational, like `FeatureTipModal` is for tips — which page is on
 * screen and what "next" means is `IntroFlow`'s business. The page chrome
 * (progress dots, "Skip tutorial") is drawn by the flow above this, so a page
 * only has to describe itself.
 */
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import { triggerSelectionHaptic } from "@/utils/long-press";

type IntroPageShellProps = {
  icon: keyof typeof MaterialIcons.glyphMap;
  title: string;
  message?: string;
  /** The page's own controls; takes whatever height the chrome leaves over. */
  children?: ReactNode;
  primaryLabel: string;
  onPrimary: () => void;
  isPrimaryDisabled?: boolean;
  isPrimaryBusy?: boolean;
  /**
   * The way past this page without doing what it asks ("I don't use
   * Letterboxd", "Skip for now"). Quiet by design: it is an escape hatch, not
   * an equal choice.
   */
  secondaryLabel?: string;
  onSecondary?: () => void;
};

export default function IntroPageShell({
  icon,
  title,
  message,
  children,
  primaryLabel,
  onPrimary,
  isPrimaryDisabled = false,
  isPrimaryBusy = false,
  secondaryLabel,
  onSecondary,
}: IntroPageShellProps) {
  const colors = useThemeColors();
  const styles = createStyles(colors);

  const handlePrimary = () => {
    triggerSelectionHaptic();
    onPrimary();
  };

  const handleSecondary = () => {
    if (!onSecondary) return;
    triggerSelectionHaptic();
    onSecondary();
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.header}>
        <View style={styles.iconBubble}>
          <MaterialIcons name={icon} size={28} color={colors.tint} />
        </View>
        <ThemedText style={styles.title}>{title}</ThemedText>
        {message ? <ThemedText style={styles.message}>{message}</ThemedText> : null}
      </View>

      <View style={styles.content}>{children}</View>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.primaryButton, (isPrimaryDisabled || isPrimaryBusy) && styles.buttonDisabled]}
          onPress={handlePrimary}
          disabled={isPrimaryDisabled || isPrimaryBusy}
          activeOpacity={0.85}
          accessibilityRole="button"
        >
          {isPrimaryBusy ? (
            <ActivityIndicator size="small" color={colors.pillActiveText} />
          ) : (
            <ThemedText style={styles.primaryLabel}>{primaryLabel}</ThemedText>
          )}
        </TouchableOpacity>
        {secondaryLabel && onSecondary ? (
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={handleSecondary}
            activeOpacity={0.7}
            accessibilityRole="button"
          >
            <ThemedText style={styles.secondaryLabel}>{secondaryLabel}</ThemedText>
          </TouchableOpacity>
        ) : null}
      </View>
    </KeyboardAvoidingView>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    container: {
      flex: 1,
      paddingHorizontal: 24,
    },
    header: {
      alignItems: "center",
      gap: 10,
      paddingTop: 8,
      paddingBottom: 18,
    },
    iconBubble: {
      width: 58,
      height: 58,
      borderRadius: 29,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.surfaceMuted,
    },
    title: {
      fontSize: 25,
      lineHeight: 31,
      fontWeight: "800",
      textAlign: "center",
      color: colors.text,
    },
    message: {
      fontSize: 15,
      lineHeight: 21,
      textAlign: "center",
      color: colors.textSecondary,
    },
    // Takes the room the header and footer do not, so a page with a long list
    // scrolls inside itself rather than pushing the buttons off screen.
    content: {
      flex: 1,
    },
    footer: {
      paddingTop: 14,
      paddingBottom: 10,
      gap: 4,
    },
    primaryButton: {
      minHeight: 52,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.tint,
    },
    buttonDisabled: {
      opacity: 0.5,
    },
    primaryLabel: {
      fontSize: 16,
      fontWeight: "700",
      color: colors.pillActiveText,
    },
    secondaryButton: {
      minHeight: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    secondaryLabel: {
      fontSize: 14,
      fontWeight: "600",
      color: colors.textSecondary,
    },
  });
