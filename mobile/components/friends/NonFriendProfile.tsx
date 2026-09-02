/**
 * Full-screen state for a user's page when the viewer isn't friends with them.
 *
 * Previously this same route rendered as if the viewer already were a
 * friend — the showtimes list and every friend-only option, just silently
 * empty (only a friend's showtimes ever load) with nothing on screen saying
 * why. This replaces that pretend view entirely: no showtimes, no visibility
 * control, no remove button — only the one thing there is to actually do
 * here, front and center, in whichever direction the relationship currently
 * points (send a request, accept/decline theirs, or cancel yours).
 *
 * Polls its own live status the same way `InlineFriendRequestButtons` does,
 * so accepting a request here (or it resolving from the other side while this
 * screen is open) is reflected without a manual refresh — and the parent
 * screen, watching the same query, swaps this out for the real agenda the
 * moment `is_friend` turns true.
 */
import { useState } from "react";
import { StyleSheet, TouchableOpacity, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import type { UserReportReason, UserWithFriendStatus } from "shared";

import ReportUserDialog from "@/components/friends/ReportUserDialog";
import { ThemedText } from "@/components/themed-text";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { useFriendActions } from "@/hooks/useFriendActions";
import { useOptimisticFriendStatus } from "@/hooks/useFriendStatus";
import { useUserModeration } from "@/hooks/useUserModeration";
import { useThemeColors } from "@/hooks/use-theme-color";
import { getAvatarColors, getAvatarInitial } from "@/utils/avatar-color";
import { triggerSelectionHaptic } from "@/utils/long-press";

type NonFriendProfileProps = {
  user: UserWithFriendStatus;
};

type Override = "sent" | "cleared" | "friend" | null;

export default function NonFriendProfile({ user: seed }: NonFriendProfileProps) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const { sendRequest, acceptRequest, declineRequest, cancelRequest, isBusy } = useFriendActions();
  const { user, override, setOverride } = useOptimisticFriendStatus<Override>(seed);
  const { blockUser, unblockUser, reportUser, isBusy: isModerationBusy } = useUserModeration();
  const [isBlockDialogVisible, setIsBlockDialogVisible] = useState(false);
  const [isReportDialogVisible, setIsReportDialogVisible] = useState(false);

  const runAction = (next: Override, action: () => void) => {
    triggerSelectionHaptic();
    setOverride(next);
    action();
  };

  const displayUser = user ?? seed;
  const name = displayUser.display_name?.trim() || "This user";
  const avatarColors = getAvatarColors(displayUser.id, colors);
  const isBlocked = displayUser.is_blocked;

  const handleConfirmBlock = () => {
    setIsBlockDialogVisible(false);
    triggerSelectionHaptic();
    blockUser(displayUser.id);
  };

  const handleUnblock = () => {
    triggerSelectionHaptic();
    unblockUser(displayUser.id);
  };

  const handleSelectReportReason = (reason: UserReportReason) => {
    reportUser({ userId: displayUser.id, reason });
    setIsReportDialogVisible(false);
  };

  const status: "friend" | "received" | "sent" | "none" =
    override === "friend"
      ? "friend"
      : override === "cleared"
        ? "none"
        : override === "sent"
          ? "sent"
          : displayUser.is_friend
            ? "friend"
            : displayUser.received_request
              ? "received"
              : displayUser.sent_request
                ? "sent"
                : "none";

  const subtitle =
    status === "received"
      ? `${name} wants to be your friend`
      : status === "sent"
        ? "Friend request sent"
        : status === "friend"
          ? "You're friends"
          : "You're not friends yet";

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <View style={[styles.avatar, { backgroundColor: avatarColors.primary }]}>
          <ThemedText style={[styles.avatarText, { color: avatarColors.secondary }]}>
            {getAvatarInitial(name)}
          </ThemedText>
        </View>
        <ThemedText style={styles.name} numberOfLines={2}>
          {name}
        </ThemedText>

        {isBlocked ? (
          // Louder than the quiet `statusRow`/`moderationLink` styling this
          // screen otherwise uses everywhere: a block is the one state here
          // that's easy to forget you're in, since nothing else about the
          // screen changes to remind you — worth its own colored badge.
          <View style={styles.blockedBanner}>
            <MaterialIcons name="block" size={14} color={colors.red.secondary} />
            <ThemedText style={styles.blockedBannerText}>You&apos;ve blocked this account</ThemedText>
          </View>
        ) : (
          <View style={styles.statusRow}>
            <MaterialIcons
              name={status === "friend" ? "people" : "lock-outline"}
              size={13}
              color={colors.textSecondary}
            />
            <ThemedText style={styles.statusText}>{subtitle}</ThemedText>
          </View>
        )}

        {isBlocked ? (
          <ThemedText style={styles.hint}>
            Unblock {name} to send or receive friend requests and invites again.
          </ThemedText>
        ) : (
          <ThemedText style={styles.hint}>
            Become friends to see {name}&apos;s agenda and invite them to showtimes.
          </ThemedText>
        )}

        {isBlocked ? null : status === "received" ? (
          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[styles.button, styles.ghostButton]}
              onPress={() => runAction("cleared", () => declineRequest(displayUser.id))}
              disabled={isBusy}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Decline friend request"
            >
              <ThemedText style={styles.ghostButtonText}>Decline</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.primaryButton]}
              onPress={() => runAction("friend", () => acceptRequest(displayUser.id))}
              disabled={isBusy}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Accept friend request"
            >
              <MaterialIcons name="check" size={16} color={colors.pillActiveText} />
              <ThemedText style={styles.primaryButtonText}>Accept</ThemedText>
            </TouchableOpacity>
          </View>
        ) : status === "sent" ? (
          <TouchableOpacity
            style={[styles.button, styles.ghostButton, styles.wideButton]}
            onPress={() => runAction("cleared", () => cancelRequest(displayUser.id))}
            disabled={isBusy}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Cancel friend request"
          >
            <MaterialIcons name="schedule" size={16} color={colors.textSecondary} />
            <ThemedText style={styles.ghostButtonText}>Cancel Request</ThemedText>
          </TouchableOpacity>
        ) : status === "none" ? (
          <TouchableOpacity
            style={[styles.button, styles.primaryButton, styles.wideButton]}
            onPress={() => runAction("sent", () => sendRequest(displayUser.id))}
            disabled={isBusy}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Add friend"
          >
            <MaterialIcons name="person-add-alt" size={16} color={colors.pillActiveText} />
            <ThemedText style={styles.primaryButtonText}>Add Friend</ThemedText>
          </TouchableOpacity>
        ) : null}

        {isBlocked ? (
          <TouchableOpacity
            style={[styles.moderationLink, styles.moderationRow]}
            onPress={handleUnblock}
            disabled={isModerationBusy}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Unblock ${name}`}
          >
            <MaterialIcons name="block" size={14} color={colors.textSecondary} />
            <ThemedText style={styles.moderationLinkText}>Unblock</ThemedText>
          </TouchableOpacity>
        ) : (
          <View style={styles.moderationRow}>
            <TouchableOpacity
              style={styles.moderationLink}
              onPress={() => setIsBlockDialogVisible(true)}
              disabled={isModerationBusy}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`Block ${name}`}
            >
              <MaterialIcons name="block" size={14} color={colors.textSecondary} />
              <ThemedText style={styles.moderationLinkText}>Block</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.moderationLink}
              onPress={() => setIsReportDialogVisible(true)}
              disabled={isModerationBusy}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`Report ${name}`}
            >
              <MaterialIcons name="flag" size={14} color={colors.textSecondary} />
              <ThemedText style={styles.moderationLinkText}>Report</ThemedText>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <ConfirmDialog
        visible={isBlockDialogVisible}
        icon="block"
        title={`Block ${name}?`}
        message="They will no longer be able to friend-request or invite you, and any friendship or invite between you is removed. They are not told you blocked them."
        confirmLabel="Block"
        cancelLabel="Cancel"
        onConfirm={handleConfirmBlock}
        onCancel={() => setIsBlockDialogVisible(false)}
      />
      <ReportUserDialog
        visible={isReportDialogVisible}
        userName={name}
        isSubmitting={isModerationBusy}
        onSelectReason={handleSelectReportReason}
        onCancel={() => setIsReportDialogVisible(false)}
      />
    </View>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    container: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 24,
    },
    card: {
      width: "100%",
      maxWidth: 340,
      alignItems: "center",
      gap: 6,
    },
    avatar: {
      width: 84,
      height: 84,
      borderRadius: 42,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 10,
    },
    avatarText: {
      fontSize: 32,
      fontWeight: "700",
      lineHeight: 38,
    },
    name: {
      fontSize: 22,
      fontWeight: "700",
      color: colors.text,
      textAlign: "center",
    },
    statusRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      marginTop: 2,
    },
    statusText: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.textSecondary,
    },
    blockedBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      marginTop: 4,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.red.border,
      backgroundColor: colors.red.primary,
    },
    blockedBannerText: {
      fontSize: 13,
      fontWeight: "700",
      color: colors.red.secondary,
    },
    hint: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.textSecondary,
      textAlign: "center",
      marginTop: 8,
      marginBottom: 20,
    },
    buttonRow: {
      flexDirection: "row",
      gap: 10,
      alignSelf: "stretch",
    },
    button: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      minHeight: 46,
      paddingHorizontal: 18,
      borderRadius: 14,
      borderWidth: 1,
      flex: 1,
    },
    wideButton: {
      alignSelf: "stretch",
      flex: undefined,
    },
    primaryButton: {
      backgroundColor: colors.tint,
      borderColor: colors.tint,
    },
    primaryButtonText: {
      fontSize: 15,
      fontWeight: "700",
      color: colors.pillActiveText,
    },
    ghostButton: {
      backgroundColor: "transparent",
      borderColor: colors.cardBorder,
    },
    ghostButtonText: {
      fontSize: 15,
      fontWeight: "700",
      color: colors.textSecondary,
    },
    moderationRow: {
      flexDirection: "row",
      gap: 18,
      marginTop: 18,
    },
    moderationLink: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      paddingVertical: 6,
    },
    moderationLinkText: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.textSecondary,
    },
  });
