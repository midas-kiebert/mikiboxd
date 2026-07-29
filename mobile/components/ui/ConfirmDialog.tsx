/**
 * Themed in-app confirmation dialog — the app-wide replacement for `Alert.alert`
 * when the user is asked to decide something, or (with no `cancelLabel`) simply
 * told it. Fades/scales in over a dimmed
 * backdrop with the same fast custom timing used by the showtime sheet's dialogs
 * (RN's built-in `animationType="fade"` is too slow to tune).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Modal, StyleSheet, TouchableOpacity, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import { triggerSelectionHaptic } from "@/utils/long-press";

const FADE_IN_MS = 140;
const FADE_OUT_MS = 120;

type ConfirmDialogProps = {
  visible: boolean;
  title: string;
  message?: string;
  icon?: keyof typeof MaterialIcons.glyphMap;
  confirmLabel: string;
  /**
   * Omit for a notice rather than a question: the dialog then has one button,
   * which only acknowledges it. `onCancel` still runs when the backdrop or the
   * back gesture closes it.
   */
  cancelLabel?: string;
  /** "destructive" paints the confirm button red; "primary" uses the app tint. */
  tone?: "destructive" | "primary";
  onConfirm: () => void;
  onCancel: () => void;
};

export default function ConfirmDialog({
  visible,
  title,
  message,
  icon,
  confirmLabel,
  cancelLabel,
  tone = "destructive",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  // Read flow: props/state setup first, then helper handlers, then returned JSX.
  const colors = useThemeColors();
  const styles = createStyles(colors);
  // Kept mounted one beat longer than `visible` so the closing fade can play out.
  const [isMounted, setIsMounted] = useState(visible);
  const anim = useRef(new Animated.Value(0)).current;
  const scale = useMemo(
    () => anim.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }),
    [anim]
  );

  useEffect(() => {
    if (visible) {
      setIsMounted(true);
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

  const handleConfirm = useCallback(() => {
    triggerSelectionHaptic();
    onConfirm();
  }, [onConfirm]);

  const isDestructive = tone === "destructive";
  const accentColor = isDestructive ? colors.red.secondary : colors.tint;

  // Render/output using the state and derived values prepared above.
  if (!isMounted) return null;

  return (
    <Modal transparent statusBarTranslucent visible animationType="none" onRequestClose={onCancel}>
      <Animated.View style={[styles.backdrop, { opacity: anim }]}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onCancel} />
        <Animated.View style={[styles.card, { transform: [{ scale }] }]}>
          {icon ? (
            <View
              style={[
                styles.iconCircle,
                { backgroundColor: isDestructive ? colors.red.primary : colors.surfaceMuted },
              ]}
            >
              <MaterialIcons name={icon} size={20} color={accentColor} />
            </View>
          ) : null}
          <ThemedText style={styles.title}>{title}</ThemedText>
          {message ? <ThemedText style={styles.message}>{message}</ThemedText> : null}
          <View style={styles.actions}>
            {cancelLabel ? (
              <TouchableOpacity
                style={[styles.button, styles.cancelButton]}
                onPress={onCancel}
                activeOpacity={0.8}
              >
                <ThemedText style={styles.cancelText}>{cancelLabel}</ThemedText>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={[
                styles.button,
                isDestructive ? styles.destructiveButton : styles.primaryButton,
              ]}
              onPress={handleConfirm}
              activeOpacity={0.8}
            >
              <ThemedText
                style={[
                  styles.confirmText,
                  { color: isDestructive ? colors.red.secondary : colors.pillActiveText },
                ]}
              >
                {confirmLabel}
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
      maxWidth: 320,
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
    actions: { flexDirection: "row", gap: 8, alignSelf: "stretch", marginTop: 8 },
    button: {
      flex: 1,
      minHeight: 42,
      borderRadius: 12,
      borderWidth: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    cancelButton: {
      backgroundColor: colors.pillBackground,
      borderColor: colors.cardBorder,
    },
    cancelText: { fontSize: 14, fontWeight: "700", color: colors.text },
    destructiveButton: {
      backgroundColor: colors.red.primary,
      borderColor: colors.red.secondary,
    },
    primaryButton: {
      backgroundColor: colors.tint,
      borderColor: colors.tint,
    },
    confirmText: { fontSize: 14, fontWeight: "700" },
  });
