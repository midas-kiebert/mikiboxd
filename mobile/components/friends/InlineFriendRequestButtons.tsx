/**
 * Compact icon-only friend-request controls for rows that already carry their
 * own name/attribution text (e.g. a showtime's "Invited" list) — a subtler
 * alternative to FriendCard's labelled buttons.
 */
import { StyleSheet, TouchableOpacity, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import type { UserWithFriendStatus } from "shared";

import { useFriendActions } from "@/hooks/useFriendActions";
import { useThemeColors } from "@/hooks/use-theme-color";

type InlineFriendRequestButtonsProps = {
  user: UserWithFriendStatus;
};

export default function InlineFriendRequestButtons({ user }: InlineFriendRequestButtonsProps) {
  const colors = useThemeColors();
  const styles = createStyles();
  const { sendRequest, acceptRequest, declineRequest, cancelRequest, isBusy } = useFriendActions();

  if (user.is_friend) {
    return null;
  }

  if (user.received_request) {
    return (
      <View style={styles.row}>
        <TouchableOpacity
          style={styles.iconButton}
          onPress={() => declineRequest(user.id)}
          disabled={isBusy}
          hitSlop={6}
          activeOpacity={0.6}
          accessibilityLabel="Decline friend request"
        >
          <MaterialIcons name="close" size={14} color={colors.textSecondary} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.iconButton}
          onPress={() => acceptRequest(user.id)}
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
        onPress={() => cancelRequest(user.id)}
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
      onPress={() => sendRequest(user.id)}
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
