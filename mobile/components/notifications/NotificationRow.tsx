/**
 * One row in the notification centre. Presentational: the provider owns the data
 * and the dismiss / accept / decline handlers. Renders an icon + accent per type,
 * a title/subtitle, a relative timestamp, and either a dismiss button or (for
 * received friend requests) inline Accept / Deny buttons.
 */
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { DateTime } from "luxon";
import type { NotificationFeedItem } from "shared";

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

const movieTitle = (item: NotificationFeedItem): string | null =>
  item.showtime?.movie.title ?? null;

// The feed item doesn't carry the going/interested status directly, so derive it
// from the showtime's friend lists (the actor appears in one of them).
const actorStatus = (item: NotificationFeedItem): "going" | "interested" | null => {
  const actorId = item.actor?.id;
  const showtime = item.showtime;
  if (!actorId || !showtime) return null;
  if (showtime.friends_going?.some((user) => user.id === actorId)) return "going";
  if (showtime.friends_interested?.some((user) => user.id === actorId)) return "interested";
  return null;
};

type Presentation = {
  icon: React.ComponentProps<typeof MaterialIcons>["name"];
  accent: ThemeColors["blue"];
  title: string;
  subtitle: string | null;
};

const buildPresentation = (item: NotificationFeedItem, colors: ThemeColors): Presentation => {
  const name = actorName(item);
  const movie = movieTitle(item);
  const status = actorStatus(item);
  const statusText = status === "interested" ? "is interested" : "is going";

  switch (item.type) {
    case "friend_showtime_match":
      return { icon: "groups", accent: colors.teal, title: `${name} ${statusText}`, subtitle: movie };
    case "invite_response":
      return {
        icon: "mark-email-read",
        accent: colors.blue,
        title: `${name} ${statusText}`,
        subtitle: movie ? `Replied to your invite · ${movie}` : "Replied to your invite",
      };
    case "showtime_invite":
      return { icon: "mail", accent: colors.blue, title: `${name} invited you`, subtitle: movie };
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

const formatRelativeTime = (isoString: string): string => {
  const parsed = DateTime.fromISO(isoString);
  if (!parsed.isValid) return "";
  return parsed.toRelative({ style: "short" }) ?? "";
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
  const isUnseen = item.seen_at === null;
  const relativeTime = formatRelativeTime(item.created_at);

  const content = (
    <View style={styles.row}>
      <View style={[styles.iconCircle, { backgroundColor: presentation.accent.primary }]}>
        <MaterialIcons name={presentation.icon} size={18} color={presentation.accent.secondary} />
      </View>
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={2}>
          {presentation.title}
        </Text>
        {presentation.subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {presentation.subtitle}
          </Text>
        ) : null}
        {isFriendRequest ? (
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: colors.green.primary }]}
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
      </View>
      <View style={styles.trailing}>
        {relativeTime ? <Text style={styles.time}>{relativeTime}</Text> : null}
        {isUnseen ? <View style={[styles.unseenDot, { backgroundColor: colors.tint }]} /> : null}
        {!isFriendRequest ? (
          <TouchableOpacity
            onPress={() => onDismiss(item)}
            hitSlop={8}
            activeOpacity={0.6}
            accessibilityRole="button"
            accessibilityLabel="Dismiss notification"
          >
            <MaterialIcons name="close" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );

  if (isFriendRequest) {
    return <View style={styles.container}>{content}</View>;
  }

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={() => onPress(item)}
      activeOpacity={0.7}
      accessibilityRole="button"
    >
      {content}
    </TouchableOpacity>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
      backgroundColor: colors.background,
    },
    row: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 12,
    },
    iconCircle: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
    },
    body: {
      flex: 1,
      gap: 2,
    },
    title: {
      fontSize: 14,
      fontWeight: "600",
      color: colors.text,
    },
    subtitle: {
      fontSize: 13,
      color: colors.textSecondary,
    },
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
    },
    actionLabel: {
      fontSize: 13,
      fontWeight: "700",
    },
    trailing: {
      alignItems: "flex-end",
      gap: 6,
    },
    time: {
      fontSize: 11,
      color: colors.textSecondary,
    },
    unseenDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
  });
