/**
 * Mobile friends feature component: Friend Card.
 *
 * One row per person in the Friends tab. The row adapts to the relationship:
 * friends get an avatar, a tap target to their showtimes and the per-friend
 * visibility control; everyone else gets a single clear request action.
 */
import { useState } from "react";
import { StyleSheet, TouchableOpacity, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import type { UserWithFriendStatus } from "shared";

import { ThemedText } from "@/components/themed-text";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import FriendVisibilityControl from "@/components/friends/FriendVisibilityControl";
import { useFriendActions } from "@/hooks/useFriendActions";
import { useFriendStatusSharing } from "@/hooks/useFriendStatusSharing";
import { useSingleFireNavigation } from "@/hooks/useSingleFireNavigation";
import { useThemeColors } from "@/hooks/use-theme-color";
import { getAvatarColors, getAvatarInitial } from "@/utils/avatar-color";
import { triggerImpactHaptic, triggerSelectionHaptic } from "@/utils/long-press";

type FriendCardProps = {
  user: UserWithFriendStatus;
  /**
   * Show the relationship label next to the name. Off by default because the
   * Friends tabs already say what every row in them is; the mixed "All users"
   * search results are the case that needs it.
   */
  showStatusBadge?: boolean;
};

/** Visual weight of a row action: one primary call to action, everything else quiet. */
type FriendActionKind = "primary" | "ghost";
type FriendAction = {
  label: string;
  /** Only the primary action carries an icon — a second one crowds out the name. */
  icon?: keyof typeof MaterialIcons.glyphMap;
  onPress: () => void;
  kind: FriendActionKind;
};

const getFriendName = (friend: UserWithFriendStatus) =>
  friend.display_name?.trim() || "Friend";

export default function FriendCard({ user, showStatusBadge = false }: FriendCardProps) {
  // Read flow: props/state setup first, then helper handlers, then returned JSX.
  const router = useRouter();
  const goToFriendShowtimes = useSingleFireNavigation((userId: string) =>
    router.push(`/friend-showtimes/${userId}`)
  );
  const colors = useThemeColors();
  const styles = createStyles(colors);

  const [isRemoveDialogVisible, setIsRemoveDialogVisible] = useState(false);

  // Data hooks keep this module synced with backend data and shared cache state.
  const { sendRequest, acceptRequest, declineRequest, cancelRequest, removeFriend, isBusy } =
    useFriendActions();

  // Paints the tapped value immediately; debounces and serializes the write.
  const { sharesStatus, change: changeStatusSharing } = useFriendStatusSharing(
    user.id,
    user.shares_status
  );

  const friendName = getFriendName(user);
  const avatarColors = getAvatarColors(user.id, colors);

  const handleConfirmRemoveFriend = () => {
    setIsRemoveDialogVisible(false);
    removeFriend(user.id);
  };

  const runAction = (action: () => void) => {
    triggerImpactHaptic();
    action();
  };

  let statusLabel: string | null = null;
  let statusColor = colors.textSecondary;
  let actions: FriendAction[] = [];

  if (user.is_friend) {
    statusLabel = "Friend";
    statusColor = colors.green.secondary;
  } else if (user.received_request) {
    statusLabel = "Sent you a request";
    statusColor = colors.orange.secondary;
    actions = [
      {
        label: "Decline",
        onPress: () => runAction(() => declineRequest(user.id)),
        kind: "ghost",
      },
      {
        label: "Accept",
        icon: "check",
        onPress: () => runAction(() => acceptRequest(user.id)),
        kind: "primary",
      },
    ];
  } else if (user.sent_request) {
    statusLabel = "Request pending";
    statusColor = colors.orange.secondary;
    actions = [
      {
        label: "Cancel",
        onPress: () => runAction(() => cancelRequest(user.id)),
        kind: "ghost",
      },
    ];
  } else {
    actions = [
      {
        label: "Add",
        icon: "person-add-alt",
        onPress: () => runAction(() => sendRequest(user.id)),
        kind: "primary",
      },
    ];
  }

  const canOpenFriendShowtimes = user.is_friend && !isBusy;

  const handleOpenFriendShowtimes = () => {
    if (!canOpenFriendShowtimes) return;
    goToFriendShowtimes(user.id);
  };

  const handleRemovePress = () => {
    if (isBusy) return;
    triggerSelectionHaptic();
    setIsRemoveDialogVisible(true);
  };

  const header = (
    <View style={styles.header}>
      <View style={[styles.avatar, { backgroundColor: avatarColors.primary }]}>
        <ThemedText style={[styles.avatarText, { color: avatarColors.secondary }]}>
          {getAvatarInitial(friendName)}
        </ThemedText>
      </View>
      <View style={styles.info}>
        <ThemedText style={styles.name} numberOfLines={1} ellipsizeMode="tail">
          {friendName}
        </ThemedText>
        {showStatusBadge && statusLabel ? (
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <ThemedText style={styles.statusText} numberOfLines={1}>
              {statusLabel}
            </ThemedText>
          </View>
        ) : null}
      </View>
      <View style={styles.actions}>
        {actions.map((action) => {
          const isPrimary = action.kind === "primary";
          return (
            <TouchableOpacity
              key={action.label}
              style={[styles.actionButton, isPrimary ? styles.actionPrimary : styles.actionGhost]}
              onPress={(event) => {
                event.stopPropagation();
                action.onPress();
              }}
              disabled={isBusy}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={`${action.label} ${friendName}`}
            >
              {action.icon ? (
                <MaterialIcons
                  name={action.icon}
                  size={15}
                  color={isPrimary ? colors.pillActiveText : colors.textSecondary}
                />
              ) : null}
              <ThemedText
                style={[
                  styles.actionText,
                  isPrimary ? styles.actionTextPrimary : styles.actionTextGhost,
                ]}
              >
                {action.label}
              </ThemedText>
            </TouchableOpacity>
          );
        })}
        {user.is_friend ? (
          <>
            <TouchableOpacity
              style={styles.iconButton}
              onPress={(event) => {
                event.stopPropagation();
                handleRemovePress();
              }}
              disabled={isBusy}
              activeOpacity={0.7}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${friendName} as a friend`}
            >
              <MaterialIcons name="person-remove-alt-1" size={17} color={colors.textSecondary} />
            </TouchableOpacity>
            <MaterialIcons name="chevron-right" size={20} color={colors.textSecondary} />
          </>
        ) : null}
      </View>
    </View>
  );

  // Render/output using the state and derived values prepared above.
  const cardContent = (
    <>
      {header}
      {user.is_friend ? (
        <>
          <View style={styles.divider} />
          <FriendVisibilityControl
            sharesStatus={sharesStatus}
            onChange={changeStatusSharing}
            disabled={isBusy}
          />
        </>
      ) : null}
    </>
  );

  const removeDialog = user.is_friend ? (
    <ConfirmDialog
      visible={isRemoveDialogVisible}
      icon="person-remove-alt-1"
      title={`Remove ${friendName}?`}
      message="You will no longer see each other's showtimes, and neither of you can send invites until you are friends again."
      confirmLabel="Remove"
      cancelLabel="Cancel"
      onConfirm={handleConfirmRemoveFriend}
      onCancel={() => setIsRemoveDialogVisible(false)}
    />
  ) : null;

  if (!user.is_friend) {
    return <View style={[styles.card, isBusy && styles.cardDisabled]}>{cardContent}</View>;
  }

  return (
    <>
      <TouchableOpacity
        style={[styles.card, isBusy && styles.cardDisabled]}
        activeOpacity={0.8}
        onPress={handleOpenFriendShowtimes}
        disabled={!canOpenFriendShowtimes}
      >
        {cardContent}
      </TouchableOpacity>
      {removeDialog}
    </>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.cardBackground,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      paddingHorizontal: 12,
      paddingVertical: 11,
      gap: 10,
    },
    cardDisabled: {
      opacity: 0.6,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    avatar: {
      width: 38,
      height: 38,
      borderRadius: 19,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarText: {
      fontSize: 16,
      fontWeight: "700",
      lineHeight: 20,
    },
    info: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    name: {
      fontSize: 15,
      fontWeight: "700",
      color: colors.text,
    },
    statusRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
    },
    statusDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
    },
    statusText: {
      flexShrink: 1,
      fontSize: 11,
      fontWeight: "600",
      color: colors.textSecondary,
    },
    actions: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    actionButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 5,
      minHeight: 34,
      paddingHorizontal: 12,
      borderRadius: 10,
      borderWidth: 1,
    },
    actionPrimary: {
      backgroundColor: colors.tint,
      borderColor: colors.tint,
    },
    actionGhost: {
      backgroundColor: "transparent",
      borderColor: colors.cardBorder,
    },
    actionText: {
      fontSize: 13,
      fontWeight: "700",
    },
    actionTextPrimary: {
      color: colors.pillActiveText,
    },
    actionTextGhost: {
      color: colors.textSecondary,
    },
    iconButton: {
      width: 34,
      height: 34,
      borderRadius: 17,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      alignItems: "center",
      justifyContent: "center",
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.divider,
    },
  });
