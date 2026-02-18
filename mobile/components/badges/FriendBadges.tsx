/**
 * Mobile badge component: Friend Badges.
 */
import {
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import type { UserPublic } from "shared";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";

type FriendBadgesProps = {
  friendsGoing?: UserPublic[];
  friendsInterested?: UserPublic[];
  variant?: "compact" | "default";
  style?: StyleProp<ViewStyle>;
};

type FriendBadgeProps = {
  label: string;
  color: string;
  textColor: string;
  styles: ReturnType<typeof createStyles>;
  variant: "compact" | "default";
};

type VariantStyles = {
  badge: ViewStyle;
  badgeText: TextStyle;
};

const getFriendLabel = (user: UserPublic) => {
  // Prefer display name when it exists.
  const displayName = user.display_name?.trim();
  if (displayName) return displayName;

  // Fallback to the email prefix when no display name is set.
  const emailName = user.email?.split("@")[0]?.trim();
  if (emailName) return emailName;

  return "Friend";
};

const FriendBadge = ({ label, color, textColor, styles, variant }: FriendBadgeProps) => {
  const sizeStyles: VariantStyles =
    variant === "compact"
      ? {
          badge: styles.compactBadge,
          badgeText: styles.compactBadgeText,
        }
      : {
          badge: styles.defaultBadge,
          badgeText: styles.defaultBadgeText,
        };

  return (
    <View style={[styles.badge, sizeStyles.badge, { backgroundColor: color, borderColor: textColor }]}>
      <ThemedText
        style={[styles.badgeText, sizeStyles.badgeText, { color: textColor }]}
        numberOfLines={1}
        ellipsizeMode="tail"
      >
        {label}
      </ThemedText>
    </View>
  );
};

export default function FriendBadges({
  friendsGoing = [],
  friendsInterested = [],
  variant = "default",
  style,
}: FriendBadgesProps) {
  // Read flow: props/state setup first, then helper handlers, then returned JSX.
  const colors = useThemeColors();
  const styles = createStyles(colors);

  const items = [
    ...friendsGoing.map((friend) => ({
      friend,
      color: colors.green.primary,
      textColor: colors.green.secondary,
    })),
    ...friendsInterested.map((friend) => ({
      friend,
      color: colors.orange.primary,
      textColor: colors.orange.secondary,
    })),
  ];

  if (items.length === 0) return null;

  // Render/output using the state and derived values prepared above.
  return (
    <View style={[styles.row, variant === "compact" ? styles.rowCompact : styles.rowDefault, style]}>
      {items.map(({ friend, color, textColor }) => (
        <FriendBadge
          key={friend.id}
          label={getFriendLabel(friend)}
          color={color}
          textColor={textColor}
          styles={styles}
          variant={variant}
        />
      ))}
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
    },
    rowDefault: {
      gap: 6,
      rowGap: 4,
    },
    badge: {
      borderWidth: 1,
      borderRadius: 3,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 6,
      maxWidth: 140,
    },
    badgeText: {
      fontWeight: "600",
      textAlignVertical: "center",
    },
    compactBadge: {
      height: 12,
      borderRadius: 2,
      paddingHorizontal: 4,
      maxWidth: 90,
    },
    compactBadgeText: {
      fontSize: 9,
      lineHeight: 12,
      fontWeight: "500",
    },
    defaultBadge: {
      height: 16,
      paddingHorizontal: 6,
    },
    defaultBadgeText: {
      fontSize: 11,
      lineHeight: 14,
    },
  });
