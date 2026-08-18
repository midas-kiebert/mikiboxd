/**
 * The per-friend controls the Friends tab offers on a `FriendCard` — "who can
 * see my showtimes" and "remove friend" — repeated here on that same friend's
 * agenda screen. A visit here already means the user is thinking about this
 * one friend specifically, so these controls belong within reach instead of
 * being a trip back to the Friends tab away.
 *
 * Deliberately not a `FriendCard`: this screen's own top bar already carries
 * the friend's name, so the card would just repeat it. Same building blocks
 * (`FriendVisibilityControl`, the remove confirm dialog, `useFriendActions`)
 * as the Friends tab, so the two places can never drift out of sync.
 *
 * Removing a friend is rare and consequential, so unlike the visibility
 * control it gets no label and no colour of its own — a small muted icon in
 * the control's own label line, deliberately anchored there rather than
 * floating loose next to it. The confirm dialog still carries the full
 * warning.
 */
import { useState } from "react";
import { StyleSheet, TouchableOpacity, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import type { UserReportReason } from "shared";

import FriendVisibilityControl from "@/components/friends/FriendVisibilityControl";
import ReportUserDialog from "@/components/friends/ReportUserDialog";
import { ThemedText } from "@/components/themed-text";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { useFriendActions } from "@/hooks/useFriendActions";
import { useFriendStatusSharing } from "@/hooks/useFriendStatusSharing";
import { useUserModeration } from "@/hooks/useUserModeration";
import { useThemeColors } from "@/hooks/use-theme-color";
import { triggerSelectionHaptic } from "@/utils/long-press";

type FriendAgendaOptionsProps = {
  friendId: string;
  friendName: string;
  sharesStatus: boolean;
};

export default function FriendAgendaOptions({
  friendId,
  friendName,
  sharesStatus,
}: FriendAgendaOptionsProps) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const router = useRouter();

  const [isRemoveDialogVisible, setIsRemoveDialogVisible] = useState(false);
  const [isBlockDialogVisible, setIsBlockDialogVisible] = useState(false);
  const [isReportDialogVisible, setIsReportDialogVisible] = useState(false);
  const { removeFriend, isBusy } = useFriendActions();
  const { blockUser, reportUser, isBusy: isModerationBusy } = useUserModeration();
  const { sharesStatus: displayedSharesStatus, change: changeStatusSharing } =
    useFriendStatusSharing(friendId, sharesStatus);

  const handleRemovePress = () => {
    if (isBusy) return;
    triggerSelectionHaptic();
    setIsRemoveDialogVisible(true);
  };

  const handleConfirmRemove = () => {
    setIsRemoveDialogVisible(false);
    removeFriend(friendId);
    // The agenda behind this friend disappears the moment they are no longer a
    // friend, so leave the screen right away rather than leaving the user on a
    // page they can no longer see.
    router.back();
  };

  const handleConfirmBlock = () => {
    setIsBlockDialogVisible(false);
    triggerSelectionHaptic();
    blockUser(friendId);
    // Blocking removes the friendship, so this screen's data disappears the
    // same way it does after Remove — same reasoning as handleConfirmRemove.
    router.back();
  };

  const handleSelectReportReason = (reason: UserReportReason) => {
    reportUser({ userId: friendId, reason });
    setIsReportDialogVisible(false);
    // Reporting blocks by default, so the friendship is gone the same way.
    router.back();
  };

  return (
    <View style={styles.card}>
      <FriendVisibilityControl
        sharesStatus={displayedSharesStatus}
        onChange={changeStatusSharing}
        disabled={isBusy}
        trailingAccessory={
          <TouchableOpacity
            style={styles.removeIconButton}
            onPress={handleRemovePress}
            disabled={isBusy}
            activeOpacity={0.6}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${friendName} as a friend`}
          >
            <MaterialIcons name="person-remove-alt-1" size={14} color={colors.textSecondary} />
          </TouchableOpacity>
        }
      />
      <View style={styles.moderationRow}>
        <TouchableOpacity
          style={styles.moderationLink}
          onPress={() => setIsBlockDialogVisible(true)}
          disabled={isModerationBusy}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={`Block ${friendName}`}
        >
          <MaterialIcons name="block" size={13} color={colors.textSecondary} />
          <ThemedText style={styles.moderationLinkText}>Block</ThemedText>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.moderationLink}
          onPress={() => setIsReportDialogVisible(true)}
          disabled={isModerationBusy}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={`Report ${friendName}`}
        >
          <MaterialIcons name="flag" size={13} color={colors.textSecondary} />
          <ThemedText style={styles.moderationLinkText}>Report</ThemedText>
        </TouchableOpacity>
      </View>
      <ConfirmDialog
        visible={isRemoveDialogVisible}
        icon="person-remove-alt-1"
        title={`Remove ${friendName}?`}
        message="You will no longer see each other's showtimes, and neither of you can send invites until you are friends again."
        confirmLabel="Remove"
        cancelLabel="Cancel"
        onConfirm={handleConfirmRemove}
        onCancel={() => setIsRemoveDialogVisible(false)}
      />
      <ConfirmDialog
        visible={isBlockDialogVisible}
        icon="block"
        title={`Block ${friendName}?`}
        message="You will no longer be friends, and neither of you can friend-request or invite the other again. They are not told you blocked them."
        confirmLabel="Block"
        cancelLabel="Cancel"
        onConfirm={handleConfirmBlock}
        onCancel={() => setIsBlockDialogVisible(false)}
      />
      <ReportUserDialog
        visible={isReportDialogVisible}
        userName={friendName}
        isSubmitting={isModerationBusy}
        onSelectReason={handleSelectReportReason}
        onCancel={() => setIsReportDialogVisible(false)}
      />
    </View>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    card: {
      // Matches the plain screen background used by the sibling filter rows
      // (FiltersButtonRow, ActiveFilterChips) below it, rather than standing
      // out as its own white card.
      backgroundColor: colors.background,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    // No label, no colour of its own: this is the one action here meant to be
    // stumbled on rarely, not read as an equal peer of the visibility control.
    // Sized to the label line it sits on rather than the taller control below.
    removeIconButton: {
      width: 20,
      height: 20,
      alignItems: "center",
      justifyContent: "center",
      opacity: 0.6,
    },
    moderationRow: {
      flexDirection: "row",
      gap: 18,
      marginTop: 10,
    },
    moderationLink: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      paddingVertical: 4,
    },
    moderationLinkText: {
      fontSize: 12,
      fontWeight: "600",
      color: colors.textSecondary,
    },
  });
