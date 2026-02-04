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

const getFriendName = (friend: UserWithFriendStatus) =>
  friend.display_name?.trim() || friend.email?.split("@")[0] || friend.email;

export default function FriendCard({ user }: FriendCardProps) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["users"] });
  };

  const removeFriendMutation = useMutation({
    mutationFn: (data: FriendsRemoveFriendData) => FriendsService.removeFriend(data),
    onSuccess: invalidate,
    onError: (error) => {
      console.error("Error removing friend:", error);
      Alert.alert("Error", "Could not remove friend.");
    },
  });

  const sendFriendRequestMutation = useMutation({
    mutationFn: (data: FriendsSendFriendRequestData) => FriendsService.sendFriendRequest(data),
    onSuccess: invalidate,
    onError: (error) => {
      console.error("Error sending friend request:", error);
      Alert.alert("Error", "Could not send friend request.");
    },
  });

  const acceptFriendRequestMutation = useMutation({
    mutationFn: (data: FriendsAcceptFriendRequestData) => FriendsService.acceptFriendRequest(data),
    onSuccess: invalidate,
    onError: (error) => {
      console.error("Error accepting friend request:", error);
      Alert.alert("Error", "Could not accept friend request.");
    },
  });

  const declineFriendRequestMutation = useMutation({
    mutationFn: (data: FriendsDeclineFriendRequestData) => FriendsService.declineFriendRequest(data),
    onSuccess: invalidate,
    onError: (error) => {
      console.error("Error declining friend request:", error);
      Alert.alert("Error", "Could not decline friend request.");
    },
  });

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
  let badgeStyle = styles.badgeNeutral;
  let actions: Array<{ label: string; onPress: () => void; style: any }> = [];

  if (user.is_friend) {
    statusLabel = "Friend";
    badgeStyle = styles.badgeSuccess;
    actions = [
      {
        label: "Remove",
        onPress: () => removeFriendMutation.mutate({ friendId: user.id }),
        style: styles.actionDanger,
      },
    ];
  } else if (user.received_request) {
    statusLabel = "Request received";
    badgeStyle = styles.badgeInfo;
    actions = [
      {
        label: "Decline",
        onPress: () => declineFriendRequestMutation.mutate({ senderId: user.id }),
        style: styles.actionDanger,
      },
      {
        label: "Accept",
        onPress: () => acceptFriendRequestMutation.mutate({ senderId: user.id }),
        style: styles.actionSuccess,
      },
    ];
  } else if (user.sent_request) {
    statusLabel = "Request sent";
    badgeStyle = styles.badgeWarning;
    actions = [
      {
        label: "Cancel",
        onPress: () => cancelFriendRequestMutation.mutate({ receiverId: user.id }),
        style: styles.actionNeutral,
      },
    ];
  } else {
    actions = [
      {
        label: "Add",
        onPress: () => sendFriendRequestMutation.mutate({ receiverId: user.id }),
        style: styles.actionSuccess,
      },
    ];
  }

  return (
    <View style={[styles.card, isBusy && styles.cardDisabled]}>
      <View style={styles.info}>
        <ThemedText style={styles.name} numberOfLines={1} ellipsizeMode="tail">
          {getFriendName(user)}
        </ThemedText>
        <ThemedText style={styles.email} numberOfLines={1} ellipsizeMode="tail">
          {user.email}
        </ThemedText>
      </View>
      {statusLabel ? (
        <View style={[styles.badge, badgeStyle]}>
          <ThemedText style={styles.badgeText}>{statusLabel}</ThemedText>
        </View>
      ) : null}
      <View style={styles.actions}>
        {actions.map((action) => (
          <TouchableOpacity
            key={action.label}
            style={[styles.actionButton, action.style]}
            onPress={action.onPress}
            disabled={isBusy}
          >
            <ThemedText style={styles.actionText}>{action.label}</ThemedText>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.cardBackground,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      padding: 12,
      gap: 8,
    },
    cardDisabled: {
      opacity: 0.6,
    },
    info: {
      gap: 4,
    },
    name: {
      fontSize: 16,
      fontWeight: "700",
      color: colors.text,
    },
    email: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    badge: {
      alignSelf: "flex-start",
      borderRadius: 10,
      paddingHorizontal: 8,
      paddingVertical: 4,
    },
    badgeText: {
      fontSize: 11,
      fontWeight: "600",
      color: colors.text,
    },
    badgeSuccess: {
      backgroundColor: colors.green.primary,
    },
    badgeWarning: {
      backgroundColor: colors.yellow.primary,
    },
    badgeInfo: {
      backgroundColor: colors.blue.primary,
    },
    badgeNeutral: {
      backgroundColor: colors.pillBackground,
    },
    actions: {
      flexDirection: "row",
      gap: 8,
      flexWrap: "wrap",
    },
    actionButton: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 8,
    },
    actionText: {
      fontSize: 12,
      fontWeight: "600",
      color: colors.text,
    },
    actionSuccess: {
      backgroundColor: colors.green.primary,
    },
    actionDanger: {
      backgroundColor: colors.red.primary,
    },
    actionNeutral: {
      backgroundColor: colors.pillBackground,
    },
  });
