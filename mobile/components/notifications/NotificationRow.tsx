/**
 * One backend feed item in the notification centre. Presentational: the provider
 * owns the data and the dismiss / accept / decline handlers. Maps the item to an
 * icon, accent and wording, then hands it to the shared row layout; received
 * friend requests add inline Accept / Deny buttons.
 */
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import type { NotificationFeedItem } from "shared";
import { getNotificationCopy } from "shared/notifications/feed-copy";

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

type Presentation = {
  icon: React.ComponentProps<typeof MaterialIcons>["name"];
  accent: ThemeColors["blue"];
  title: string;
  subtitle: string | null;
};

/**
 * Icon and accent per type. The wording is shared with the website via
 * `shared/notifications/feed-copy`, so the two clients cannot describe the same
 * event differently.
 */
const PRESENTATION: Record<
  NotificationFeedItem["type"],
  { icon: Presentation["icon"]; accent: (colors: ThemeColors) => ThemeColors["blue"] }
> = {
  friend_showtime_match: { icon: "groups", accent: (c) => c.teal },
  invite_response: { icon: "mark-email-read", accent: (c) => c.blue },
  showtime_invite: { icon: "mail", accent: (c) => c.blue },
  friend_request_received: { icon: "person-add", accent: (c) => c.purple },
  friend_request_accepted: { icon: "how-to-reg", accent: (c) => c.green },
  seats_running_out: { icon: "local-fire-department", accent: (c) => c.orange },
  sold_out: { icon: "event-busy", accent: (c) => c.redDeep },
  seats_released: { icon: "confirmation-number", accent: (c) => c.green },
};

const buildPresentation = (item: NotificationFeedItem, colors: ThemeColors): Presentation => {
  const { icon, accent } = PRESENTATION[item.type];
  return { icon, accent: accent(colors), ...getNotificationCopy(item) };
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
