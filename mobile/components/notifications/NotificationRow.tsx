/**
 * One backend feed item in the notification centre. Presentational: the provider
 * owns the data and the dismiss / accept / decline handlers. Maps the item to an
 * icon, accent and wording, then hands it to the shared row layout; received
 * friend requests add inline Accept / Deny buttons.
 */
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { DateTime } from "luxon";
import type { NotificationFeedItem } from "shared";

import NotificationRowLayout from "@/components/notifications/NotificationRowLayout";
import { useThemeColors } from "@/hooks/use-theme-color";

type ThemeColors = typeof import("@/constants/theme").Colors.light;

type NotificationRowProps = {
  item: NotificationFeedItem;
  onPress: (item: NotificationFeedItem) => void;
  onDismiss: (item: NotificationFeedItem) => void;
  onAccept: (item: NotificationFeedItem) => void;
  onDecline: (item: NotificationFeedItem) => void;
  isAccepting: boolean;
  isDeclining: boolean;
};

const actorName = (item: NotificationFeedItem): string =>
  item.actor?.display_name?.trim() || "A friend";

// The feed item doesn't carry the going/interested status directly, so derive it
// from the showtime's friend lists (the actor appears in one of them).
const actorStatus = (item: NotificationFeedItem): "going" | "interested" | null => {
  const actorId = item.actor?.id;
  const showtime = item.showtime;
  if (!actorId || !showtime) return null;
  if (showtime.friends_going?.some((u) => u.id === actorId)) return "going";
  if (showtime.friends_interested?.some((u) => u.id === actorId)) return "interested";
  return null;
};

const formatShowtimeSubtitle = (item: NotificationFeedItem, prefix?: string): string | null => {
  const showtime = item.showtime;
  if (!showtime) return prefix ?? null;
  const dt = DateTime.fromISO(showtime.datetime);
  const dateTime = dt.isValid ? `${dt.toFormat("ccc, LLL d")} · ${dt.toFormat("HH:mm")}` : null;
  const parts = [prefix, dateTime, showtime.cinema.name].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
};

type Presentation = {
  icon: React.ComponentProps<typeof MaterialIcons>["name"];
  accent: ThemeColors["blue"];
  title: string;
  subtitle: string | null;
};

const buildPresentation = (item: NotificationFeedItem, colors: ThemeColors): Presentation => {
  const name = actorName(item);
  const movie = item.showtime?.movie.title ?? null;
  const status = actorStatus(item);
  const statusVerb = status === "going" ? "is going to" : "is interested in";

  switch (item.type) {
    case "friend_showtime_match":
      return {
        icon: "groups",
        accent: colors.teal,
        title: movie ? `${name} ${statusVerb} ${movie}` : `${name} ${statusVerb === "is going to" ? "is going" : "is interested"}`,
        subtitle: formatShowtimeSubtitle(item),
      };
    case "invite_response":
      return {
        icon: "mark-email-read",
        accent: colors.blue,
        title: movie ? `${name} ${statusVerb} ${movie}` : `${name} ${statusVerb === "is going to" ? "is going" : "is interested"}`,
        subtitle: formatShowtimeSubtitle(item, "Replied to your invite"),
      };
    case "showtime_invite":
      return {
        icon: "mail",
        accent: colors.blue,
        title: movie ? `${name} invited you to ${movie}` : `${name} invited you`,
        subtitle: formatShowtimeSubtitle(item),
      };
    case "friend_request_received":
      return {
        icon: "person-add",
        accent: colors.purple,
        title: `${name} sent you a friend request`,
        subtitle: null,
      };
    case "friend_request_accepted":
      return {
        icon: "how-to-reg",
        accent: colors.green,
        title: `${name} accepted your friend request`,
        subtitle: null,
      };
  }
};

export default function NotificationRow({
  item,
  onPress,
  onDismiss,
  onAccept,
  onDecline,
  isAccepting,
  isDeclining,
}: NotificationRowProps) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const presentation = buildPresentation(item, colors);
  const isFriendRequest = item.type === "friend_request_received";

  return (
    <NotificationRowLayout
      icon={presentation.icon}
      accent={presentation.accent}
      title={presentation.title}
      subtitle={presentation.subtitle}
      timestamp={item.created_at}
      isUnseen={item.seen_at === null}
      // Friend requests are answered by their own buttons, so the row itself
      // is inert and carries no ✕.
      onPress={isFriendRequest ? undefined : () => onPress(item)}
      onDismiss={isFriendRequest ? undefined : () => onDismiss(item)}
    >
      {isFriendRequest ? (
        <View style={styles.actions}>
          <TouchableOpacity
            style={[
              styles.actionButton,
              { backgroundColor: colors.green.primary, borderColor: colors.green.border },
            ]}
            onPress={() => onAccept(item)}
            disabled={isAccepting || isDeclining}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Accept friend request"
          >
            {isAccepting ? (
              <ActivityIndicator size="small" color={colors.green.secondary} />
            ) : (
              <Text style={[styles.actionLabel, { color: colors.green.secondary }]}>Accept</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: colors.pillBackground }]}
            onPress={() => onDecline(item)}
            disabled={isAccepting || isDeclining}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Decline friend request"
          >
            {isDeclining ? (
              <ActivityIndicator size="small" color={colors.textSecondary} />
            ) : (
              <Text style={[styles.actionLabel, { color: colors.textSecondary }]}>Deny</Text>
            )}
          </TouchableOpacity>
        </View>
      ) : null}
    </NotificationRowLayout>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    actions: {
      flexDirection: "row",
      gap: 8,
      marginTop: 8,
    },
    actionButton: {
      paddingHorizontal: 16,
      paddingVertical: 7,
      borderRadius: 16,
      minWidth: 72,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: colors.pillBorder,
    },
    actionLabel: {
      fontSize: 13,
      fontWeight: "700",
    },
  });
