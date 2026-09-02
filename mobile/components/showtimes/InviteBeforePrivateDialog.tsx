/**
 * Confirmation shown right before a showtime's visibility switches to
 * INVITED_ONLY, or right before the viewer marks going/interested, when
 * friends are already going/interested but were never pinged. Left alone,
 * those friends would silently be unable to see the owner's status — this
 * offers to invite them (non-notifying, since they already know) to keep
 * them in the loop. `title`/`message` default to the visibility-switch
 * copy; the going/interested flow passes its own.
 *
 * Structurally a checkbox-list variant of ConfirmDialog (same Modal + fade
 * timing), since ConfirmDialog itself has no list slot.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Modal, ScrollView, StyleSheet, TouchableOpacity, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import type { UserPublic } from "shared";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import { getAvatarColors, getAvatarInitial } from "@/utils/avatar-color";
import { triggerSelectionHaptic } from "@/utils/long-press";

const FADE_IN_MS = 140;
const FADE_OUT_MS = 120;

type InviteBeforePrivateDialogProps = {
  visible: boolean;
  friends: UserPublic[];
  onConfirm: (selectedIds: string[]) => void;
  onSkip: () => void;
  title?: string;
  message?: string;
};

const DEFAULT_TITLE = "Keep these friends in the loop?";
const DEFAULT_MESSAGE =
  "These friends already see your status here but haven't been invited. Switching " +
  "to invite-only will hide it from them unless you invite them now.";

export default function InviteBeforePrivateDialog({
  visible,
  friends,
  onConfirm,
  onSkip,
  title = DEFAULT_TITLE,
  message = DEFAULT_MESSAGE,
}: InviteBeforePrivateDialogProps) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const [isMounted, setIsMounted] = useState(visible);
  const anim = useRef(new Animated.Value(0)).current;
  const scale = useMemo(
    () => anim.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }),
    [anim]
  );

  // Every friend starts checked — the default is to keep everyone who can
  // currently see the owner's status able to keep seeing it.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Guards against a fast double-tap firing onConfirm/onSkip twice before the
  // parent's `visible` prop flips back to false and this dialog starts
  // unmounting — a second confirm would try to invite the same friends again.
  const hasSubmittedRef = useRef(false);
  useEffect(() => {
    if (visible) {
      setSelectedIds(new Set(friends.map((friend) => friend.id)));
      hasSubmittedRef.current = false;
    }
    // Only reseed when the dialog opens, so unchecking a friend mid-session
    // isn't clobbered by an unrelated re-render of `friends`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

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

  const toggleFriend = useCallback((friendId: string) => {
    triggerSelectionHaptic();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(friendId)) {
        next.delete(friendId);
      } else {
        next.add(friendId);
      }
      return next;
    });
  }, []);

  const handleConfirm = useCallback(() => {
    if (hasSubmittedRef.current) return;
    hasSubmittedRef.current = true;
    triggerSelectionHaptic();
    onConfirm(Array.from(selectedIds));
  }, [onConfirm, selectedIds]);

  const handleSkip = useCallback(() => {
    if (hasSubmittedRef.current) return;
    hasSubmittedRef.current = true;
    onSkip();
  }, [onSkip]);

  if (!isMounted) return null;

  return (
    <Modal transparent statusBarTranslucent visible animationType="none" onRequestClose={handleSkip}>
      <Animated.View style={[styles.backdrop, { opacity: anim }]}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={handleSkip} />
        <Animated.View style={[styles.card, { transform: [{ scale }] }]}>
          <View style={[styles.iconCircle, { backgroundColor: colors.surfaceMuted }]}>
            <MaterialIcons name="visibility-off" size={20} color={colors.tint} />
          </View>
          <ThemedText style={styles.title}>{title}</ThemedText>
          <ThemedText style={styles.message}>{message}</ThemedText>
          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {friends.map((friend) => {
              const isSelected = selectedIds.has(friend.id);
              const avatarColors = getAvatarColors(friend.id, colors);
              const name = friend.display_name ?? "Friend";
              return (
                <TouchableOpacity
                  key={friend.id}
                  style={styles.friendRow}
                  onPress={() => toggleFriend(friend.id)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.avatar, { backgroundColor: avatarColors.primary }]}>
                    <ThemedText style={[styles.avatarText, { color: avatarColors.secondary }]}>
                      {getAvatarInitial(name)}
                    </ThemedText>
                  </View>
                  <ThemedText style={styles.friendName} numberOfLines={1} ellipsizeMode="tail">
                    {name}
                  </ThemedText>
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
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.button, styles.cancelButton]}
              onPress={handleSkip}
              activeOpacity={0.8}
            >
              <ThemedText style={styles.cancelText}>Skip</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.primaryButton]}
              onPress={handleConfirm}
              activeOpacity={0.8}
            >
              <ThemedText style={[styles.confirmText, { color: colors.pillActiveText }]}>
                Invite &amp; continue
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
    friendRow: {
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
    avatar: {
      width: 26,
      height: 26,
      borderRadius: 13,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarText: { fontSize: 12, fontWeight: "700", lineHeight: 15 },
    friendName: { flex: 1, minWidth: 0, fontSize: 14, fontWeight: "600", color: colors.text },
    checkbox: {
      width: 20,
      height: 20,
      borderRadius: 5,
      borderWidth: 1.5,
      borderColor: colors.cardBorder,
      alignItems: "center",
      justifyContent: "center",
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
    primaryButton: {
      backgroundColor: colors.tint,
      borderColor: colors.tint,
    },
    confirmText: { fontSize: 14, fontWeight: "700" },
  });
