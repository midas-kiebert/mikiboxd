/**
 * Mobile friends feature component: Friend Card.
 */
import { Alert, StyleSheet, TouchableOpacity, View } from "react-native";
import type { UserWithFriendStatus } from "shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  FriendsService,
  type FriendsRemoveFriendData,
  type FriendsAcceptFriendRequestData,
  type FriendsSendFriendRequestData,
  type FriendsCancelFriendRequestData,
  type FriendsDeclineFriendRequestData,
} from "shared";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";

type FriendCardProps = {
  user: UserWithFriendStatus;
};

type FriendActionKind = "positive" | "negative" | "neutral";
type FriendAction = {
  label: string;
  onPress: () => void;
  kind: FriendActionKind;
};

const getFriendName = (friend: UserWithFriendStatus) =>
  friend.display_name?.trim() || friend.email?.split("@")[0] || friend.email;

export default function FriendCard({ user }: FriendCardProps) {
  // Read flow: props/state setup first, then helper handlers, then returned JSX.
  const colors = useThemeColors();
  const styles = createStyles(colors);
  // React Query client used for cache updates and invalidation.
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["users"] });
  };

  // Data hooks keep this module synced with backend data and shared cache state.
  const removeFriendMutation = useMutation({
    mutationFn: (data: FriendsRemoveFriendData) => FriendsService.removeFriend(data),
    onSuccess: invalidate,
    onError: (error) => {
      console.error("Error removing friend:", error);
      Alert.alert("Error", "Could not remove friend.");
    },
  });

  // Send a new friend request to this user.
  const sendFriendRequestMutation = useMutation({
    mutationFn: (data: FriendsSendFriendRequestData) => FriendsService.sendFriendRequest(data),
    onSuccess: invalidate,
    onError: (error) => {
      console.error("Error sending friend request:", error);
      Alert.alert("Error", "Could not send friend request.");
    },
  });

  // Accept a received friend request.
  const acceptFriendRequestMutation = useMutation({
    mutationFn: (data: FriendsAcceptFriendRequestData) => FriendsService.acceptFriendRequest(data),
    onSuccess: invalidate,
    onError: (error) => {
      console.error("Error accepting friend request:", error);
      Alert.alert("Error", "Could not accept friend request.");
    },
  });

  // Decline a received friend request.
  const declineFriendRequestMutation = useMutation({
    mutationFn: (data: FriendsDeclineFriendRequestData) => FriendsService.declineFriendRequest(data),
    onSuccess: invalidate,
    onError: (error) => {
      console.error("Error declining friend request:", error);
      Alert.alert("Error", "Could not decline friend request.");
    },
  });

  // Cancel a previously sent friend request.
  const cancelFriendRequestMutation = useMutation({
    mutationFn: (data: FriendsCancelFriendRequestData) => FriendsService.cancelFriendRequest(data),
    onSuccess: invalidate,
    onError: (error) => {
      console.error("Error cancelling friend request:", error);
      Alert.alert("Error", "Could not cancel friend request.");
    },
  });

  const isBusy =
    removeFriendMutation.isPending ||
    sendFriendRequestMutation.isPending ||
    acceptFriendRequestMutation.isPending ||
    declineFriendRequestMutation.isPending ||
    cancelFriendRequestMutation.isPending;

  let statusLabel: string | null = null;
  let badgeBackgroundColor = colors.pillBackground;
  let badgeTextColor = colors.pillText;
  let actions: FriendAction[] = [];

  if (user.is_friend) {
    statusLabel = "Friend";
    badgeBackgroundColor = colors.green.primary;
    badgeTextColor = colors.green.secondary;
    actions = [
      {
        label: "Remove",
        onPress: () => removeFriendMutation.mutate({ friendId: user.id }),
        kind: "negative",
      },
    ];
  } else if (user.received_request) {
    statusLabel = "Request received";
    badgeBackgroundColor = colors.orange.primary;
    badgeTextColor = colors.orange.secondary;
    actions = [
      {
        label: "Decline",
        onPress: () => declineFriendRequestMutation.mutate({ senderId: user.id }),
        kind: "negative",
      },
      {
        label: "Accept",
        onPress: () => acceptFriendRequestMutation.mutate({ senderId: user.id }),
        kind: "positive",
      },
    ];
  } else if (user.sent_request) {
    statusLabel = "Request sent";
    badgeBackgroundColor = colors.orange.primary;
    badgeTextColor = colors.orange.secondary;
    actions = [
      {
        label: "Cancel",
        onPress: () => cancelFriendRequestMutation.mutate({ receiverId: user.id }),
        kind: "neutral",
      },
    ];
  } else {
    actions = [
      {
        label: "Add",
        onPress: () => sendFriendRequestMutation.mutate({ receiverId: user.id }),
        kind: "positive",
      },
    ];
  }

  const getActionStyles = (kind: FriendActionKind) => {
    if (kind === "positive") {
      return [styles.actionButtonPositive, styles.actionTextPositive] as const;
    }
    if (kind === "negative") {
      return [styles.actionButtonNegative, styles.actionTextNegative] as const;
    }
    return [styles.actionButtonNeutral, styles.actionTextNeutral] as const;
  };

  // Render/output using the state and derived values prepared above.
  return (
    <View style={[styles.card, isBusy && styles.cardDisabled]}>
      <View style={styles.info}>
        <View style={styles.nameRow}>
          <ThemedText style={styles.name} numberOfLines={1} ellipsizeMode="tail">
            {getFriendName(user)}
          </ThemedText>
          {statusLabel ? (
            <View
              style={[
                styles.badge,
                { backgroundColor: badgeBackgroundColor, borderColor: badgeTextColor },
              ]}
            >
              <ThemedText style={[styles.badgeText, { color: badgeTextColor }]}>{statusLabel}</ThemedText>
            </View>
          ) : null}
        </View>
        <ThemedText style={styles.email} numberOfLines={1} ellipsizeMode="tail">
          {user.email}
        </ThemedText>
      </View>
      <View style={styles.actions}>
        {actions.map((action) => {
          const [buttonStyle, textStyle] = getActionStyles(action.kind);
          return (
            <TouchableOpacity
              key={action.label}
              style={[styles.actionButton, buttonStyle]}
              onPress={action.onPress}
              disabled={isBusy}
              activeOpacity={0.75}
            >
              <ThemedText style={[styles.actionText, textStyle]}>{action.label}</ThemedText>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    card: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.cardBackground,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      padding: 12,
      gap: 12,
    },
    cardDisabled: {
      opacity: 0.6,
    },
    info: {
      flex: 1,
      minWidth: 0,
      gap: 4,
    },
    nameRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    name: {
      flexShrink: 1,
      fontSize: 16,
      fontWeight: "700",
      color: colors.text,
    },
    email: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    badge: {
      borderWidth: 1,
      borderRadius: 3,
      height: 16,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 6,
      maxWidth: 140,
    },
    badgeText: {
      fontSize: 11,
      fontWeight: "600",
      lineHeight: 14,
    },
    actions: {
      flexDirection: "column",
      alignItems: "flex-end",
      justifyContent: "center",
      gap: 8,
    },
    actionButton: {
      minHeight: 34,
      minWidth: 84,
      paddingHorizontal: 14,
      paddingVertical: 7,
      borderRadius: 999,
      borderWidth: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    actionText: {
      fontSize: 13,
      fontWeight: "700",
    },
    actionButtonPositive: {
      backgroundColor: colors.green.primary,
      borderColor: colors.green.secondary,
      shadowColor: colors.green.secondary,
      shadowOpacity: 0.15,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
      elevation: 1,
    },
    actionButtonNegative: {
      backgroundColor: colors.red.primary,
      borderColor: colors.red.secondary,
    },
    actionButtonNeutral: {
      backgroundColor: colors.pillBackground,
      borderColor: colors.cardBorder,
    },
    actionTextPositive: {
      color: colors.green.secondary,
    },
    actionTextNegative: {
      color: colors.red.secondary,
    },
    actionTextNeutral: {
      color: colors.text,
    },
  });
