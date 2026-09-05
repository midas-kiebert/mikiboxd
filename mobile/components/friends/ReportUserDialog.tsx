/**
 * "Report this person" reason picker, offered from a non-friend's profile and
 * from a friend's own agenda screen — the mobile side of App Store Review
 * guideline 1.2's "mechanism to report offensive content".
 *
 * Same fade/scale timing and card chrome as `ConfirmDialog`, but a list of
 * reasons rather than two buttons: reporting is a choice among several
 * specific concerns, not a yes/no.
 *
 * Reporting also blocks by default (`blockUser: true` on the mutation) — the
 * two are one gesture here because nobody reports someone they still want to
 * hear from, and `useUserModeration` records them as separate backend rows so
 * lifting the block later never withdraws the report.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Animated, Modal, StyleSheet, TouchableOpacity, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import type { UserReportReason } from "shared";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import { triggerSelectionHaptic } from "@/utils/long-press";
import { useAnimatedValue } from "@/hooks/useAnimatedValue";

const FADE_IN_MS = 140;
const FADE_OUT_MS = 120;

const REPORT_REASON_OPTIONS: { value: UserReportReason; label: string }[] = [
  { value: "objectionable_username", label: "Objectionable username" },
  { value: "impersonation", label: "Impersonation" },
  { value: "repeated_unwanted_contact", label: "Repeated unwanted requests or invites" },
  { value: "spam", label: "Spam" },
  { value: "other", label: "Something else" },
];

type ReportUserDialogProps = {
  visible: boolean;
  /** Shown in the title — "Report {name}?" — so the target is never ambiguous. */
  userName: string;
  isSubmitting: boolean;
  onSelectReason: (reason: UserReportReason) => void;
  onCancel: () => void;
};

export default function ReportUserDialog({
  visible,
  userName,
  isSubmitting,
  onSelectReason,
  onCancel,
}: ReportUserDialogProps) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const [isMounted, setIsMounted] = useState(visible);
  if (visible && !isMounted) {
    setIsMounted(true);
  }
  const anim = useAnimatedValue(0);
  const scale = useMemo(
    () => anim.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }),
    [anim]
  );

  useEffect(() => {
    if (visible) {
      anim.setValue(0);
      Animated.timing(anim, { toValue: 1, duration: FADE_IN_MS, useNativeDriver: true }).start();
      return;
    }
    Animated.timing(anim, { toValue: 0, duration: FADE_OUT_MS, useNativeDriver: true }).start(() =>
      setIsMounted(false)
    );
  }, [visible, anim]);

  const handleSelect = useCallback(
    (reason: UserReportReason) => {
      if (isSubmitting) return;
      triggerSelectionHaptic();
      onSelectReason(reason);
    },
    [isSubmitting, onSelectReason]
  );

  if (!isMounted) return null;

  return (
    <Modal transparent statusBarTranslucent visible animationType="none" onRequestClose={onCancel}>
      <Animated.View style={[styles.backdrop, { opacity: anim }]}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onCancel} />
        <Animated.View style={[styles.card, { transform: [{ scale }] }]}>
          <View style={[styles.iconCircle, { backgroundColor: colors.red.primary }]}>
            <MaterialIcons name="flag" size={20} color={colors.red.secondary} />
          </View>
          <ThemedText style={styles.title}>Report {userName}?</ThemedText>
          <ThemedText style={styles.message}>
            This also blocks them. You can unblock from Settings.
          </ThemedText>
          <View style={styles.reasonList}>
            {REPORT_REASON_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option.value}
                style={styles.reasonOption}
                onPress={() => handleSelect(option.value)}
                disabled={isSubmitting}
                activeOpacity={0.7}
              >
                <ThemedText style={styles.reasonOptionText}>{option.label}</ThemedText>
                <MaterialIcons name="chevron-right" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity style={styles.cancelButton} onPress={onCancel} activeOpacity={0.8}>
            <ThemedText style={styles.cancelText}>Cancel</ThemedText>
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
      marginBottom: 4,
    },
    reasonList: { alignSelf: "stretch", gap: 2 },
    reasonOption: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: 12,
      paddingHorizontal: 4,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    reasonOptionText: { fontSize: 14, fontWeight: "600", color: colors.text },
    cancelButton: {
      alignSelf: "stretch",
      minHeight: 42,
      borderRadius: 12,
      borderWidth: 1,
      backgroundColor: colors.pillBackground,
      borderColor: colors.cardBorder,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 8,
    },
    cancelText: { fontSize: 14, fontWeight: "700", color: colors.text },
  });
