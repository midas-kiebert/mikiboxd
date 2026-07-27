/**
 * The frame every auth screen (log in, sign up, pick a username) sits in.
 *
 * Exists so the three of them cannot drift: this is the first thing anyone sees
 * of the app, and a title that is two points bigger on one screen than the next,
 * or a form that sits eight pixels further left, reads as sloppy long before
 * anyone can say why.
 *
 * It also owns the error banner, which is the one thing on these screens that
 * appears and disappears under the user: it is tweened in rather than inserted,
 * so a failed login does not shunt the whole form up a line.
 */
import type { ReactNode } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import { useLayoutAnimatedValue } from "@/hooks/useLayoutAnimatedValue";

type AuthScreenShellProps = {
  title: string;
  subtitle?: string;
  /** Server-side failure for the whole screen; field errors live on the fields. */
  error?: string | null;
  /** The form itself. */
  children: ReactNode;
  /** Links and secondary actions, pinned below the form. */
  footer?: ReactNode;
};

export default function AuthScreenShell({
  title,
  subtitle,
  error,
  children,
  footer,
}: AuthScreenShellProps) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  // Tweens the banner in and out instead of inserting it under the user.
  const visibleError = useLayoutAnimatedValue(error ?? null);

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        // Android already resizes the window for the keyboard (adjustResize).
        // Asking KeyboardAvoidingView to do it again on top of that makes the
        // form jump twice for one keyboard.
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* Scrollable so the submit button stays reachable when the keyboard
            takes half the screen on a small phone, or when the user's font
            scale makes the form taller than the viewport. */}
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            {/* The same mark the splash shows, so the hand-off from launch to
                this screen is the same logo rather than a second one. */}
            <Image
              source={require("../../assets/images/splash-icon.png")}
              style={styles.brandMark}
              resizeMode="contain"
            />
            <ThemedText style={styles.title}>{title}</ThemedText>
            {subtitle ? <ThemedText style={styles.subtitle}>{subtitle}</ThemedText> : null}
          </View>

          {visibleError ? (
            <View style={styles.errorBanner}>
              <MaterialIcons name="error-outline" size={18} color={colors.red.secondary} />
              <ThemedText style={styles.errorText}>{visibleError}</ThemedText>
            </View>
          ) : null}

          {children}

          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    flex: {
      flex: 1,
    },
    content: {
      // flexGrow (not flex) so the form still centres when it fits, but the
      // ScrollView can grow past the viewport when it doesn't.
      flexGrow: 1,
      justifyContent: "center",
      paddingHorizontal: 24,
      paddingVertical: 18,
    },
    // Sized to leave the form itself on screen: the sign-up form is four fields
    // and two provider buttons, and a header that took a third of the viewport
    // pushed the thing the user actually came here to do below the fold.
    header: {
      alignItems: "center",
      gap: 6,
      paddingBottom: 16,
    },
    brandMark: {
      width: 60,
      height: 60,
    },
    title: {
      fontSize: 24,
      lineHeight: 30,
      fontWeight: "800",
      textAlign: "center",
      color: colors.text,
    },
    subtitle: {
      fontSize: 14,
      lineHeight: 19,
      textAlign: "center",
      color: colors.textSecondary,
    },
    errorBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      backgroundColor: colors.red.primary,
      borderWidth: 1,
      borderColor: colors.red.secondary,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 9,
      marginBottom: 12,
    },
    errorText: {
      flex: 1,
      color: colors.red.secondary,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "600",
    },
    footer: {
      paddingTop: 14,
      gap: 12,
    },
  });
