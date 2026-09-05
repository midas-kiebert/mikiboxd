/**
 * Confirmation shown right after the viewer marks a showtime "going" when
 * they already had other showtimes of the same movie marked "interested"
 * (and none of those others are "going" — see `ShowtimeActionModal`). Left
 * alone, those stale "interested" marks just clutter the movie's showtime
 * list, so this offers to clear them.
 *
 * Structurally the same checkbox-list shape as `InviteBeforePrivateDialog`,
 * plus a "don't ask again" row that persists straight to
 * `interested-elsewhere-reminder` when checked, independent of whether the
 * viewer confirms or skips the removal itself.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Modal, ScrollView, StyleSheet, TouchableOpacity, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { DateTime } from "luxon";
import type { ShowtimeInMoviePublic } from "shared";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import { triggerSelectionHaptic } from "@/utils/long-press";
import { useAnimatedValue } from "@/hooks/useAnimatedValue";
import { setRemoveInterestedReminderEnabled } from "@/utils/interested-elsewhere-reminder";

const FADE_IN_MS = 140;
const FADE_OUT_MS = 120;

type RemoveInterestedElsewhereDialogProps = {
  visible: boolean;
  showtimes: ShowtimeInMoviePublic[];
  onConfirm: (selectedIds: number[]) => void;
  onSkip: () => void;
};

const TITLE = "Clear your other “interested” marks?";
const MESSAGE =
  "You're going to this showing. Want to remove “interested” from these other " +
  "showings of the same movie?";

export default function RemoveInterestedElsewhereDialog({
  visible,
  showtimes,
  onConfirm,
  onSkip,
}: RemoveInterestedElsewhereDialogProps) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const [isMounted, setIsMounted] = useState(visible);
  const anim = useAnimatedValue(0);
  const scale = useMemo(
    () => anim.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }),
    [anim]
  );

  // Every showtime starts checked — the default is to clear all of the stale
  // interested marks. Reseeded once per open, same as InviteBeforePrivateDialog.
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [dontAskAgain, setDontAskAgain] = useState(false);
  if (visible && !isMounted) {
    setIsMounted(true);
    setSelectedIds(new Set(showtimes.map((showtime) => showtime.id)));
    setDontAskAgain(false);
  }
  const hasSubmittedRef = useRef(false);
  useEffect(() => {
    if (visible) {
      hasSubmittedRef.current = false;
    }
  }, [visible]);

  useEffect(() => {
    if (visible) {
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

  const toggleShowtime = useCallback((showtimeId: number) => {
    triggerSelectionHaptic();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(showtimeId)) {
        next.delete(showtimeId);
      } else {
        next.add(showtimeId);
      }
      return next;
    });
  }, []);

  const toggleDontAskAgain = useCallback(() => {
    triggerSelectionHaptic();
    setDontAskAgain((prev) => !prev);
  }, []);

  const applyDontAskAgain = useCallback(() => {
    if (dontAskAgain) setRemoveInterestedReminderEnabled(false);
  }, [dontAskAgain]);

  const handleConfirm = useCallback(() => {
    if (hasSubmittedRef.current) return;
    hasSubmittedRef.current = true;
    triggerSelectionHaptic();
    applyDontAskAgain();
    onConfirm(Array.from(selectedIds));
  }, [applyDontAskAgain, onConfirm, selectedIds]);

  const handleSkip = useCallback(() => {
    if (hasSubmittedRef.current) return;
    hasSubmittedRef.current = true;
    applyDontAskAgain();
    onSkip();
  }, [applyDontAskAgain, onSkip]);

  if (!isMounted) return null;

  return (
    <Modal transparent statusBarTranslucent visible animationType="none" onRequestClose={handleSkip}>
      <Animated.View style={[styles.backdrop, { opacity: anim }]}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={handleSkip} />
        <Animated.View style={[styles.card, { transform: [{ scale }] }]}>
          <View style={[styles.iconCircle, { backgroundColor: colors.surfaceMuted }]}>
            <MaterialIcons name="playlist-remove" size={20} color={colors.tint} />
          </View>
          <ThemedText style={styles.title}>{TITLE}</ThemedText>
          <ThemedText style={styles.message}>{MESSAGE}</ThemedText>
          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {showtimes.map((showtime) => {
              const isSelected = selectedIds.has(showtime.id);
              const start = DateTime.fromISO(showtime.datetime);
              const label = start.isValid ? start.toFormat("ccc d LLL · HH:mm") : "";
              return (
                <TouchableOpacity
                  key={showtime.id}
                  style={styles.showtimeRow}
                  onPress={() => toggleShowtime(showtime.id)}
                  activeOpacity={0.7}
                >
                  <View style={styles.showtimeTextContainer}>
                    <ThemedText style={styles.showtimeCinema} numberOfLines={1} ellipsizeMode="tail">
                      {showtime.cinema.name}
                    </ThemedText>
                    <ThemedText style={styles.showtimeTime}>{label}</ThemedText>
                  </View>
                  <View
                    style={[
                      styles.checkbox,
                      isSelected && { backgroundColor: colors.tint, borderColor: colors.tint },
                    ]}
                  >
                    {isSelected ? (
                      <MaterialIcons name="check" size={14} color={colors.pillActiveText} />
                    ) : null}
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <TouchableOpacity
            style={styles.dontAskRow}
            onPress={toggleDontAskAgain}
            activeOpacity={0.7}
          >
            <View
              style={[
                styles.checkbox,
                dontAskAgain && { backgroundColor: colors.tint, borderColor: colors.tint },
              ]}
            >
              {dontAskAgain ? (
                <MaterialIcons name="check" size={14} color={colors.pillActiveText} />
              ) : null}
            </View>
            <ThemedText style={styles.dontAskText}>Don't ask me again</ThemedText>
          </TouchableOpacity>
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.button, styles.cancelButton]}
              onPress={handleSkip}
              activeOpacity={0.8}
            >
              <ThemedText style={styles.cancelText}>Keep as is</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.primaryButton]}
              onPress={handleConfirm}
              activeOpacity={0.8}
            >
              <ThemedText style={[styles.confirmText, { color: colors.pillActiveText }]}>
                Remove
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
      maxHeight: "80%",
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
    list: {
      alignSelf: "stretch",
      maxHeight: 220,
      marginTop: 4,
    },
    listContent: { gap: 6 },
    showtimeRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 9,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.pillBackground,
      paddingLeft: 10,
      paddingRight: 10,
      paddingVertical: 7,
    },
    showtimeTextContainer: { flex: 1, minWidth: 0, gap: 1 },
    showtimeCinema: { fontSize: 14, fontWeight: "600", color: colors.text },
    showtimeTime: { fontSize: 12, color: colors.textSecondary },
    checkbox: {
      width: 20,
      height: 20,
      borderRadius: 5,
      borderWidth: 1.5,
      borderColor: colors.cardBorder,
      alignItems: "center",
      justifyContent: "center",
    },
    dontAskRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      alignSelf: "stretch",
      marginTop: 6,
    },
    dontAskText: { fontSize: 13, color: colors.textSecondary },
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
    primaryButton: {
      backgroundColor: colors.tint,
      borderColor: colors.tint,
    },
    confirmText: { fontSize: 14, fontWeight: "700" },
  });
