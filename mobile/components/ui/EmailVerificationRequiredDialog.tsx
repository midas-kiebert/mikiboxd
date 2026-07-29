/**
 * Themed replacement for the plain "confirm your email first" alert that used
 * to gate every attempt to route something to email (the watchlist digest,
 * a notification preference) before the address is confirmed. A bare notice
 * left the user stuck — this adds the one thing they can actually do about it,
 * a resend, right where the ask appears.
 *
 * Controlled like `ConfirmDialog`: the caller owns `visible` and clears it via
 * `onClose`. The resend state resets on each open so a stale "Link sent" from
 * a previous prompt never lingers into the next one.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Modal, StyleSheet, TouchableOpacity, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { MeService } from "shared";

import { ThemedText } from "@/components/themed-text";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useThemeColors } from "@/hooks/use-theme-color";
import { triggerSelectionHaptic } from "@/utils/long-press";

const FADE_IN_MS = 140;
const FADE_OUT_MS = 120;

type EmailVerificationRequiredDialogProps = {
  visible: boolean;
  onClose: () => void;
};

export default function EmailVerificationRequiredDialog({
  visible,
  onClose,
}: EmailVerificationRequiredDialogProps) {
  // Read flow: data/state setup first, then handlers, then the JSX.
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const user = useCurrentUser();
  const [isMounted, setIsMounted] = useState(visible);
  const [hasResent, setHasResent] = useState(false);
  const anim = useRef(new Animated.Value(0)).current;
  const scale = useMemo(
    () => anim.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }),
    [anim]
  );

  useEffect(() => {
    if (visible) {
      setIsMounted(true);
      setHasResent(false);
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
    }).start(() => setIsMounted(false));
  }, [visible, anim]);

  const handleResend = useCallback(() => {
    // Painted before the request goes out, same as the tip's own resend: the
    // backend reports success either way, so there is nothing worth waiting for.
    triggerSelectionHaptic();
    setHasResent(true);
    MeService.resendEmailVerification().catch(() => {});
  }, []);

  const handleClose = useCallback(() => {
    triggerSelectionHaptic();
    onClose();
  }, [onClose]);

  if (!isMounted) return null;

  return (
    <Modal transparent statusBarTranslucent visible animationType="none" onRequestClose={onClose}>
      <Animated.View style={[styles.backdrop, { opacity: anim }]}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <Animated.View style={[styles.card, { transform: [{ scale }] }]}>
          <View style={[styles.iconCircle, { backgroundColor: colors.surfaceMuted }]}>
            <MaterialIcons name="mark-email-unread" size={20} color={colors.tint} />
          </View>
          <ThemedText style={styles.title}>Confirm your email first</ThemedText>
          <ThemedText style={styles.message}>
            We can&apos;t email you until you&apos;ve opened the confirmation link we sent.
          </ThemedText>
          <View style={styles.details}>
            <ThemedText style={styles.address}>{user?.email ?? ""}</ThemedText>
            <ThemedText style={styles.hint}>
              {hasResent
                ? "Check your inbox, and your spam folder."
                : "Already opened it? It may take a moment to take effect."}
            </ThemedText>
          </View>
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.button, styles.cancelButton]}
              onPress={handleClose}
              activeOpacity={0.8}
            >
              <ThemedText style={styles.cancelText}>Not now</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.primaryButton, hasResent && styles.buttonDisabled]}
              onPress={handleResend}
              disabled={hasResent}
              activeOpacity={0.8}
            >
              <ThemedText style={[styles.confirmText, { color: colors.pillActiveText }]}>
                {hasResent ? "Link sent" : "Send the link again"}
              </ThemedText>
            </TouchableOpacity>
          </View>
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
    details: {
      gap: 4,
      alignItems: "center",
      marginTop: 2,
    },
    address: {
      fontSize: 14,
      lineHeight: 19,
      fontWeight: "700",
      color: colors.text,
      textAlign: "center",
    },
    hint: {
      fontSize: 12,
      lineHeight: 16,
      color: colors.textSecondary,
      textAlign: "center",
    },
    actions: { flexDirection: "row", gap: 8, alignSelf: "stretch", marginTop: 8 },
    button: {
      flex: 1,
      minHeight: 42,
      borderRadius: 12,
      borderWidth: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    buttonDisabled: {
      opacity: 0.5,
    },
    cancelButton: {
      backgroundColor: colors.pillBackground,
      borderColor: colors.cardBorder,
    },
    cancelText: { fontSize: 14, fontWeight: "700", color: colors.text },
    primaryButton: {
      backgroundColor: colors.tint,
      borderColor: colors.tint,
    },
    confirmText: { fontSize: 14, fontWeight: "700" },
  });
