/**
 * Compact icon-only friend-request controls for rows that already carry their
 * own name/attribution text (e.g. a showtime's "Invited" list) — a subtler
 * alternative to FriendCard's full pill-button treatment.
 */
import { Alert, StyleSheet, TouchableOpacity, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { FriendsService } from "shared";
import type {
  UserWithFriendStatus,
  FriendsAcceptFriendRequestData,
  FriendsSendFriendRequestData,
  FriendsCancelFriendRequestData,
  FriendsDeclineFriendRequestData,
} from "shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useThemeColors } from "@/hooks/use-theme-color";

type InlineFriendRequestButtonsProps = {
  user: UserWithFriendStatus;
};

export default function InlineFriendRequestButtons({ user }: InlineFriendRequestButtonsProps) {
  const colors = useThemeColors();
  const styles = createStyles();
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["users"] });
  };

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
    sendFriendRequestMutation.isPending ||
    acceptFriendRequestMutation.isPending ||
    declineFriendRequestMutation.isPending ||
    cancelFriendRequestMutation.isPending;

  if (user.is_friend) {
    return null;
  }

  if (user.received_request) {
    return (
      <View style={styles.row}>
        <TouchableOpacity
          style={styles.iconButton}
          onPress={() => declineFriendRequestMutation.mutate({ senderId: user.id })}
          disabled={isBusy}
          hitSlop={6}
          activeOpacity={0.6}
          accessibilityLabel="Decline friend request"
        >
          <MaterialIcons name="close" size={14} color={colors.textSecondary} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.iconButton}
          onPress={() => acceptFriendRequestMutation.mutate({ senderId: user.id })}
          disabled={isBusy}
          hitSlop={6}
          activeOpacity={0.6}
          accessibilityLabel="Accept friend request"
        >
          <MaterialIcons name="check" size={14} color={colors.green.secondary} />
        </TouchableOpacity>
      </View>
    );
  }

  if (user.sent_request) {
    return (
      <TouchableOpacity
        style={styles.iconButton}
        onPress={() => cancelFriendRequestMutation.mutate({ receiverId: user.id })}
        disabled={isBusy}
        hitSlop={6}
        activeOpacity={0.6}
        accessibilityLabel="Cancel friend request"
      >
        <MaterialIcons name="schedule" size={14} color={colors.textSecondary} />
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      style={styles.iconButton}
      onPress={() => sendFriendRequestMutation.mutate({ receiverId: user.id })}
      disabled={isBusy}
      hitSlop={6}
      activeOpacity={0.6}
      accessibilityLabel="Send friend request"
    >
      <MaterialIcons name="person-add-alt" size={14} color={colors.textSecondary} />
    </TouchableOpacity>
  );
}

const createStyles = () =>
  StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    iconButton: {
      padding: 2,
      borderRadius: 4,
    },
  });
