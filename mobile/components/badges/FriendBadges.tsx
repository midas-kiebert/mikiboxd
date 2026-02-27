/**
 * Mobile badge component: Friend Badges.
 */
import {
  StyleSheet,
  TouchableOpacity,
  View,
  type GestureResponderEvent,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { useRouter } from "expo-router";
import type { UserPublic } from "shared";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";

type FriendBadgesProps = {
  friendsGoing?: UserPublic[];
  friendsInterested?: UserPublic[];
  variant?: "compact" | "default";
  maxVisible?: number;
  style?: StyleProp<ViewStyle>;
};

type FriendBadgeProps = {
  friendId: string;
  label: string;
  backgroundColor: string;
  accentColor: string;
  styles: ReturnType<typeof createStyles>;
  variant: "compact" | "default";
};

type VariantStyles = {
  badge: ViewStyle;
  badgeText: TextStyle;
  statusDot: ViewStyle;
};

const FRIEND_BADGE_HIT_SLOP = { top: 4, bottom: 4, left: 4, right: 4 } as const;

const getFriendLabel = (user: UserPublic) => {
  // Prefer display name when it exists.
  const displayName = user.display_name?.trim();
  if (displayName) return displayName;

  return "Friend";
};

const FriendBadge = ({
  friendId,
  label,
  backgroundColor,
  accentColor,
  styles,
  variant,
}: FriendBadgeProps) => {
  const router = useRouter();
  const sizeStyles: VariantStyles =
    variant === "compact"
      ? {
          badge: styles.compactBadge,
          badgeText: styles.compactBadgeText,
          statusDot: styles.compactStatusDot,
        }
      : {
          badge: styles.defaultBadge,
          badgeText: styles.defaultBadgeText,
          statusDot: styles.defaultStatusDot,
        };

  const handlePress = (event: GestureResponderEvent) => {
    event.stopPropagation();
    router.push(`/friend-showtimes/${friendId}`);
  };

  return (
    <TouchableOpacity
      activeOpacity={0.75}
      onPress={handlePress}
      hitSlop={FRIEND_BADGE_HIT_SLOP}
      style={[
        styles.badge,
        sizeStyles.badge,
        { backgroundColor, borderColor: accentColor },
      ]}
    >
      <View style={[styles.statusDot, sizeStyles.statusDot, { backgroundColor: accentColor }]} />
      <ThemedText
        style={[styles.badgeText, sizeStyles.badgeText, { color: accentColor }]}
        numberOfLines={1}
        ellipsizeMode="tail"
      >
        {label}
      </ThemedText>
    </TouchableOpacity>
  );
};

export default function FriendBadges({
  friendsGoing = [],
  friendsInterested = [],
  variant = "default",
  maxVisible,
  style,
}: FriendBadgesProps) {
  // Read flow: props/state setup first, then helper handlers, then returned JSX.
  const colors = useThemeColors();
  const styles = createStyles(colors);

  const items = [
    ...friendsGoing.map((friend) => ({
      friend,
      backgroundColor: colors.pillBackground,
      accentColor: colors.friendGoing.secondary,
    })),
    ...friendsInterested.map((friend) => ({
      friend,
      backgroundColor: colors.pillBackground,
      accentColor: colors.friendInterested.secondary,
    })),
  ];
  const visibleItems = typeof maxVisible === "number" ? items.slice(0, Math.max(maxVisible, 0)) : items;
  const hiddenCount = Math.max(items.length - visibleItems.length, 0);
  const overflowSizeStyles =
    variant === "compact"
      ? {
          badge: styles.compactBadge,
          badgeText: styles.compactBadgeText,
        }
      : {
          badge: styles.defaultBadge,
          badgeText: styles.defaultBadgeText,
        };

  if (items.length === 0) return null;

  // Render/output using the state and derived values prepared above.
  return (
    <View style={[styles.row, variant === "compact" ? styles.rowCompact : styles.rowDefault, style]}>
      {visibleItems.map(({ friend, backgroundColor, accentColor }) => (
        <FriendBadge
          key={friend.id}
          friendId={friend.id}
          label={getFriendLabel(friend)}
          backgroundColor={backgroundColor}
          accentColor={accentColor}
          styles={styles}
          variant={variant}
        />
      ))}
      {hiddenCount > 0 ? (
        <View
          style={[
            styles.badge,
            overflowSizeStyles.badge,
            styles.overflowBadge,
            { borderColor: colors.cardBorder },
          ]}
        >
          <ThemedText
            style={[styles.badgeText, overflowSizeStyles.badgeText, styles.overflowBadgeText]}
            numberOfLines={1}
          >
            +{hiddenCount}
          </ThemedText>
        </View>
      ) : null}
    </View>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      flexWrap: "wrap",
      gap: 4,
      rowGap: 2,
    },
    rowCompact: {
      gap: 4,
      rowGap: 1,
      flexWrap: "nowrap",
      overflow: "hidden",
    },
    rowDefault: {
      gap: 6,
      rowGap: 4,
    },
    badge: {
      borderWidth: 1,
      borderRadius: 999,
      alignItems: "center",
      justifyContent: "flex-start",
      flexDirection: "row",
      columnGap: 4,
      paddingHorizontal: 6,
      maxWidth: 160,
      minWidth: 0,
      overflow: "hidden",
    },
    statusDot: {
      borderRadius: 999,
      flexShrink: 0,
    },
    badgeText: {
      fontWeight: "600",
      includeFontPadding: false,
      flexShrink: 1,
      minWidth: 0,
    },
    compactBadge: {
      minHeight: 14,
      paddingHorizontal: 4,
      paddingVertical: 1,
      maxWidth: 100,
    },
    compactStatusDot: {
      width: 4,
      height: 4,
    },
    compactBadgeText: {
      fontSize: 9,
      lineHeight: 10,
      fontWeight: "500",
    },
    defaultBadge: {
      minHeight: 18,
      paddingHorizontal: 6,
      paddingVertical: 1,
    },
    defaultStatusDot: {
      width: 6,
      height: 6,
    },
    defaultBadgeText: {
      fontSize: 11,
      lineHeight: 12,
    },
    overflowBadge: {
      backgroundColor: colors.pillBackground,
      justifyContent: "center",
    },
    overflowBadgeText: {
      color: colors.textSecondary,
    },
  });
