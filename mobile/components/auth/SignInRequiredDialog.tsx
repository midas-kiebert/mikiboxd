/**
 * What a guest sees when they tap something an account is needed for.
 *
 * Deliberately not a `ConfirmDialog`: this asks for two different yeses (make
 * an account, or use the one you have) rather than yes/no, and the dismiss is
 * the quiet third option — a guest who only wanted to look should be able to
 * carry on looking without having said no to anything.
 *
 * Same fade/scale timing as the app's other dialogs, so an intercepted tap
 * feels like the rest of the app rather than like being stopped.
 */
import { useEffect, useMemo, useState } from "react";
import { Animated, Modal, StyleSheet, TouchableOpacity, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { ThemedText } from "@/components/themed-text";
import { ACCOUNT_FEATURE_COPY, type AccountFeature } from "@/components/auth/account-features";
import { useThemeColors } from "@/hooks/use-theme-color";
import { triggerSelectionHaptic } from "@/utils/long-press";
import { useAnimatedValue } from "@/hooks/useAnimatedValue";

const FADE_IN_MS = 140;
const FADE_OUT_MS = 120;

type SignInRequiredDialogProps = {
  /** The feature that was reached for; null closes the dialog. */
  feature: AccountFeature | null;
  onSignUp: () => void;
  onLogIn: () => void;
  onDismiss: () => void;
};

export default function SignInRequiredDialog({
  feature,
  onSignUp,
  onLogIn,
  onDismiss,
}: SignInRequiredDialogProps) {
  // Read flow: props/state setup first, then handlers, then the JSX.
  const colors = useThemeColors();
  const styles = createStyles(colors);
  // Kept mounted one beat longer than `feature` so the closing fade can play out,
  // and so the copy doesn't blank out halfway through it.
  const [shownFeature, setShownFeature] = useState(feature);
  if (feature && feature !== shownFeature) {
    setShownFeature(feature);
  }
  const anim = useAnimatedValue(0);
  const scale = useMemo(
    () => anim.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }),
    [anim]
  );

  useEffect(() => {
    if (feature) {
      anim.setValue(0);
      Animated.timing(anim, {
        toValue: 1,
        duration: FADE_IN_MS,
        useNativeDriver: true,
      }).start();
      return;
    }
    Animated.timing(anim, {
      toValue: 0,
      duration: FADE_OUT_MS,
      useNativeDriver: true,
    }).start(() => setShownFeature(null));
  }, [feature, anim]);

  if (!shownFeature) return null;

  const copy = ACCOUNT_FEATURE_COPY[shownFeature];

  const handleSignUp = () => {
    triggerSelectionHaptic();
    onSignUp();
  };

  const handleLogIn = () => {
    triggerSelectionHaptic();
    onLogIn();
  };

  return (
    <Modal transparent statusBarTranslucent visible animationType="none" onRequestClose={onDismiss}>
      <Animated.View style={[styles.backdrop, { opacity: anim }]}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onDismiss} />
        <Animated.View style={[styles.card, { transform: [{ scale }] }]}>
          <View style={[styles.iconCircle, { backgroundColor: colors.surfaceMuted }]}>
            <MaterialIcons name={copy.icon} size={20} color={colors.tint} />
          </View>
          <ThemedText style={styles.title}>{copy.title}</ThemedText>
          <ThemedText style={styles.message}>{copy.message}</ThemedText>
          {/* Stacked, not side by side: these are two different yeses rather
              than a confirm/cancel pair, so neither should read as the way out. */}
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.button, styles.primaryButton]}
              onPress={handleSignUp}
              activeOpacity={0.8}
              accessibilityRole="button"
            >
              <ThemedText style={[styles.primaryText, { color: colors.pillActiveText }]}>
                Create an account
              </ThemedText>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.secondaryButton]}
              onPress={handleLogIn}
              activeOpacity={0.8}
              accessibilityRole="button"
            >
              <ThemedText style={styles.secondaryText}>I already have one</ThemedText>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            onPress={onDismiss}
            hitSlop={8}
            activeOpacity={0.7}
            accessibilityRole="button"
          >
            <ThemedText style={styles.dismissText}>Keep looking around</ThemedText>
          </TouchableOpacity>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: "rgba(0, 0, 0, 0.28)",
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 20,
    },
    card: {
      width: "100%",
      maxWidth: 340,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBackground,
      paddingHorizontal: 20,
      paddingTop: 18,
      paddingBottom: 14,
      alignItems: "center",
      gap: 8,
      shadowColor: "#000",
      shadowOpacity: 0.2,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
      elevation: 10,
    },
    iconCircle: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 2,
    },
    title: { fontSize: 17, fontWeight: "700", color: colors.text, textAlign: "center" },
    message: {
      fontSize: 13,
      lineHeight: 18,
      textAlign: "center",
      color: colors.textSecondary,
    },
    hint: {
      fontSize: 12,
      lineHeight: 16,
      textAlign: "center",
      color: colors.textSecondary,
      opacity: 0.85,
    },
    actions: { alignSelf: "stretch", gap: 8, marginTop: 10 },
    button: {
      minHeight: 44,
      borderRadius: 12,
      borderWidth: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    primaryButton: {
      backgroundColor: colors.tint,
      borderColor: colors.tint,
    },
    primaryText: { fontSize: 14, fontWeight: "700" },
    secondaryButton: {
      backgroundColor: colors.pillBackground,
      borderColor: colors.cardBorder,
    },
    secondaryText: { fontSize: 14, fontWeight: "700", color: colors.text },
    dismissText: {
      fontSize: 12,
      fontWeight: "600",
      color: colors.textSecondary,
      paddingTop: 8,
      paddingBottom: 2,
    },
  });
