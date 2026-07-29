/**
 * Compact labeled friend-request controls for rows that already carry their
 * own name/attribution text (e.g. a showtime's "Invited" list) — the same
 * add/requested/accept-decline vocabulary as FriendCard, sized for a tighter row.
 *
 * The showtime this row belongs to is plain local state on the modal (not
 * react-query cached), so a status change never reaches it on its own —
 * neither the local mutation's own effect nor one made from the other side
 * (they declined, or a mutual request auto-resolved to friends). This polls
 * its own live status via useOptimisticFriendStatus instead of trusting the
 * `user` snapshot for anything beyond the very first paint.
 */
import { StyleSheet, TouchableOpacity, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import type { UserWithFriendStatus } from "shared";

import { ThemedText } from "@/components/themed-text";
import { useFriendActions } from "@/hooks/useFriendActions";
import { useOptimisticFriendStatus } from "@/hooks/useFriendStatus";
import { useThemeColors } from "@/hooks/use-theme-color";
import { triggerSelectionHaptic } from "@/utils/long-press";

type InlineFriendRequestButtonsProps = {
  user: UserWithFriendStatus;
};

type Override = "sent" | "cleared" | "friend" | null;

export default function InlineFriendRequestButtons({
  user: seed,
}: InlineFriendRequestButtonsProps) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const { sendRequest, acceptRequest, declineRequest, cancelRequest, isBusy } = useFriendActions();

  const { user, override, setOverride } = useOptimisticFriendStatus<Override>(seed);

  const runAction = (next: Override, action: () => void) => {
    triggerSelectionHaptic();
    setOverride(next);
    action();
  };

  const status: "friend" | "received" | "sent" | "none" =
    override === "friend"
      ? "friend"
      : override === "cleared"
        ? "none"
        : override === "sent"
          ? "sent"
          : user.is_friend
            ? "friend"
            : user.received_request
              ? "received"
              : user.sent_request
                ? "sent"
                : "none";

  if (status === "friend") return null;

  if (status === "received") {
    return (
      <View style={styles.row}>
        <TouchableOpacity
          style={[styles.pill, styles.pillGhost]}
          onPress={(event) => {
            event.stopPropagation();
            runAction("cleared", () => declineRequest(user.id));
          }}
          disabled={isBusy}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Decline friend request"
        >
          <ThemedText style={[styles.pillText, styles.pillTextGhost]}>Decline</ThemedText>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.pill, styles.pillPrimary]}
          onPress={(event) => {
            event.stopPropagation();
            runAction("friend", () => acceptRequest(user.id));
          }}
          disabled={isBusy}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Accept friend request"
        >
          <MaterialIcons name="check" size={13} color={colors.pillActiveText} />
          <ThemedText style={[styles.pillText, styles.pillTextPrimary]}>Accept</ThemedText>
        </TouchableOpacity>
      </View>
    );
  }

  if (status === "sent") {
    return (
      <TouchableOpacity
        style={[styles.pill, styles.pillGhost]}
        onPress={(event) => {
          event.stopPropagation();
          runAction("cleared", () => cancelRequest(user.id));
        }}
        disabled={isBusy}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel="Cancel friend request"
      >
        <MaterialIcons name="schedule" size={12} color={colors.textSecondary} />
        <ThemedText style={[styles.pillText, styles.pillTextGhost]}>Requested</ThemedText>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      style={[styles.pill, styles.pillPrimary]}
      onPress={(event) => {
        event.stopPropagation();
        runAction("sent", () => sendRequest(user.id));
      }}
      disabled={isBusy}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel="Add friend"
    >
      <MaterialIcons name="person-add-alt" size={13} color={colors.pillActiveText} />
      <ThemedText style={[styles.pillText, styles.pillTextPrimary]}>Add Friend</ThemedText>
    </TouchableOpacity>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    pill: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 4,
      minHeight: 28,
      paddingHorizontal: 11,
      borderRadius: 14,
      borderWidth: 1,
    },
    pillPrimary: {
      backgroundColor: colors.tint,
      borderColor: colors.tint,
    },
    pillGhost: {
      backgroundColor: "transparent",
      borderColor: colors.cardBorder,
    },
    pillText: {
      fontSize: 11,
      lineHeight: 13,
      fontWeight: "700",
    },
    pillTextPrimary: {
      color: colors.pillActiveText,
    },
    pillTextGhost: {
      color: colors.textSecondary,
    },
  });
