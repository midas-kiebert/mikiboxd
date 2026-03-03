/**
 * Mobile badge component: Friend Badges.
 */
import { useCallback, useMemo, useState } from "react";
import {
  StyleSheet,
  TouchableOpacity,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
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
  maxRows?: number;
  style?: StyleProp<ViewStyle>;
};

type FriendBadgeProps = {
  badgeKey: string;
  friendId: string;
  name: string;
  seatLabel?: string | null;
  backgroundColor: string;
  accentColor: string;
  styles: ReturnType<typeof createStyles>;
  variant: "compact" | "default";
  onMeasureWidth?: (badgeKey: string, width: number) => void;
};

type VariantStyles = {
  badge: ViewStyle;
  badgeText: TextStyle;
  badgeSeatText: TextStyle;
  statusDot: ViewStyle;
};

type BadgeItem = {
  key: string;
  friend: UserPublic;
  backgroundColor: string;
  accentColor: string;
};

const FRIEND_BADGE_HIT_SLOP = { top: 4, bottom: 4, left: 4, right: 4 } as const;
const COMPACT_BADGE_MIN_HEIGHT = 14;
const COMPACT_BADGE_ROW_GAP = 2;
const COMPACT_BADGE_HORIZONTAL_GAP = 4;
const DEFAULT_BADGE_HORIZONTAL_GAP = 6;
const COMPACT_BADGE_FALLBACK_WIDTH = 80;
const DEFAULT_BADGE_FALLBACK_WIDTH = 110;
const COMPACT_OVERFLOW_BADGE_FALLBACK_WIDTH = 28;
const DEFAULT_OVERFLOW_BADGE_FALLBACK_WIDTH = 32;

const getFriendName = (user: UserPublic) => {
  // Prefer display name when it exists.
  const displayName = user.display_name?.trim();
  if (displayName) return displayName;

  return "Friend";
};

const getSeatLabel = (user: UserPublic): string | null => {
  const seatRow = user.seat_row?.trim();
  const seatNumber = user.seat_number?.trim();
  if (!seatRow && !seatNumber) {
    return null;
  }
  if (!seatRow) {
    return seatNumber ?? null;
  }
  if (!seatNumber) {
    return seatRow;
  }

  const isNumericRow = /^\d+$/.test(seatRow);
  const isNumericSeat = /^\d+$/.test(seatNumber);
  const isLetterRow = /^[A-Za-z]+$/.test(seatRow);
  if (isNumericRow && isNumericSeat) {
    return `${seatRow}-${seatNumber}`;
  }
  if (isLetterRow && isNumericSeat) {
    return `${seatRow}${seatNumber}`;
  }
  return `${seatRow}-${seatNumber}`;
};

const FriendBadge = ({
  badgeKey,
  friendId,
  name,
  seatLabel,
  backgroundColor,
  accentColor,
  styles,
  variant,
  onMeasureWidth,
}: FriendBadgeProps) => {
  const router = useRouter();
  const sizeStyles: VariantStyles =
    variant === "compact"
      ? {
          badge: styles.compactBadge,
          badgeText: styles.compactBadgeText,
          badgeSeatText: styles.compactBadgeSeatText,
          statusDot: styles.compactStatusDot,
        }
      : {
          badge: styles.defaultBadge,
          badgeText: styles.defaultBadgeText,
          badgeSeatText: styles.defaultBadgeSeatText,
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
      onLayout={(event) => {
        if (!onMeasureWidth) return;
        const width = Math.ceil(event.nativeEvent.layout.width);
        onMeasureWidth(badgeKey, width);
      }}
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
        {name}
        {seatLabel ? (
          <ThemedText style={[styles.badgeSeatText, sizeStyles.badgeSeatText, { color: accentColor }]}>
            {" "}
            ({seatLabel})
          </ThemedText>
        ) : null}
      </ThemedText>
    </TouchableOpacity>
  );
};

export default function FriendBadges({
  friendsGoing = [],
  friendsInterested = [],
  variant = "default",
  maxVisible,
  maxRows,
  style,
}: FriendBadgesProps) {
  // Read flow: props/state setup first, then helper handlers, then returned JSX.
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const [containerWidth, setContainerWidth] = useState(0);
  const [measuredBadgeWidths, setMeasuredBadgeWidths] = useState<Record<string, number>>({});
  const [overflowBadgeWidth, setOverflowBadgeWidth] = useState(0);

  const items: BadgeItem[] = [
    ...friendsGoing.map((friend) => ({
      key: `going-${friend.id}`,
      friend,
      backgroundColor: colors.pillBackground,
      accentColor: colors.friendGoing.secondary,
    })),
    ...friendsInterested.map((friend) => ({
      key: `interested-${friend.id}`,
      friend,
      backgroundColor: colors.pillBackground,
      accentColor: colors.friendInterested.secondary,
    })),
  ];

  const candidateItems =
    typeof maxVisible === "number"
      ? items.slice(0, Math.max(maxVisible, 0))
      : items;
  const horizontalGap =
    variant === "compact"
      ? COMPACT_BADGE_HORIZONTAL_GAP
      : DEFAULT_BADGE_HORIZONTAL_GAP;
  const defaultBadgeWidth =
    variant === "compact"
      ? COMPACT_BADGE_FALLBACK_WIDTH
      : DEFAULT_BADGE_FALLBACK_WIDTH;
  const defaultOverflowWidth =
    variant === "compact"
      ? COMPACT_OVERFLOW_BADGE_FALLBACK_WIDTH
      : DEFAULT_OVERFLOW_BADGE_FALLBACK_WIDTH;

  const countRowsForWidths = useCallback(
    (widths: number[]) => {
      if (widths.length === 0) return 0;
      if (containerWidth <= 0) return 1;

      let rows = 1;
      let rowWidth = 0;
      for (const rawWidth of widths) {
        const width = Math.min(Math.max(1, rawWidth), containerWidth);
        if (rowWidth === 0) {
          rowWidth = width;
          continue;
        }
        const nextRowWidth = rowWidth + horizontalGap + width;
        if (nextRowWidth <= containerWidth) {
          rowWidth = nextRowWidth;
          continue;
        }
        rows += 1;
        rowWidth = width;
      }
      return rows;
    },
    [containerWidth, horizontalGap]
  );

  const visibleCount = useMemo(() => {
    if (!maxRows || maxRows <= 0 || candidateItems.length === 0 || containerWidth <= 0) {
      return candidateItems.length;
    }

    let count = candidateItems.length;
    while (count > 0) {
      const visibleWidths = candidateItems
        .slice(0, count)
        .map((item) => measuredBadgeWidths[item.key] ?? defaultBadgeWidth);
      const hiddenCountForCandidate = items.length - count;
      const widthsToTest =
        hiddenCountForCandidate > 0
          ? [...visibleWidths, overflowBadgeWidth || defaultOverflowWidth]
          : visibleWidths;
      if (countRowsForWidths(widthsToTest) <= maxRows) {
        break;
      }
      count -= 1;
    }

    return count;
  }, [
    candidateItems,
    containerWidth,
    countRowsForWidths,
    defaultBadgeWidth,
    defaultOverflowWidth,
    items.length,
    maxRows,
    measuredBadgeWidths,
    overflowBadgeWidth,
  ]);

  const visibleItems = candidateItems.slice(0, visibleCount);
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
  const compactRowMaxHeight =
    variant === "compact" && maxRows && maxRows > 0
      ? maxRows * COMPACT_BADGE_MIN_HEIGHT + (maxRows - 1) * COMPACT_BADGE_ROW_GAP
      : undefined;

  const handleContainerLayout = (event: LayoutChangeEvent) => {
    const width = Math.ceil(event.nativeEvent.layout.width);
    if (width === containerWidth) return;
    setContainerWidth(width);
  };

  const handleMeasureBadgeWidth = useCallback((badgeKey: string, width: number) => {
    setMeasuredBadgeWidths((previous) => {
      if (previous[badgeKey] === width) return previous;
      return {
        ...previous,
        [badgeKey]: width,
      };
    });
  }, []);

  if (items.length === 0) return null;

  // Render/output using the state and derived values prepared above.
  return (
    <View
      style={[
        styles.row,
        variant === "compact" ? styles.rowCompact : styles.rowDefault,
        compactRowMaxHeight ? { maxHeight: compactRowMaxHeight } : null,
        style,
      ]}
      onLayout={handleContainerLayout}
    >
      {visibleItems.map(({ key, friend, backgroundColor, accentColor }) => (
        <FriendBadge
          key={key}
          badgeKey={key}
          friendId={friend.id}
          name={getFriendName(friend)}
          seatLabel={getSeatLabel(friend)}
          backgroundColor={backgroundColor}
          accentColor={accentColor}
          styles={styles}
          variant={variant}
          onMeasureWidth={handleMeasureBadgeWidth}
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
          onLayout={(event) => {
            const width = Math.ceil(event.nativeEvent.layout.width);
            if (width === overflowBadgeWidth) return;
            setOverflowBadgeWidth(width);
          }}
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
      rowGap: COMPACT_BADGE_ROW_GAP,
      flexWrap: "wrap",
      overflow: "hidden",
      alignItems: "flex-start",
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
    badgeSeatText: {
      fontWeight: "500",
      opacity: 0.9,
    },
    compactBadgeSeatText: {
      fontSize: 8,
      lineHeight: 9,
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
    defaultBadgeSeatText: {
      fontSize: 9,
      lineHeight: 10,
    },
    overflowBadge: {
      backgroundColor: colors.pillBackground,
      justifyContent: "center",
    },
    overflowBadgeText: {
      color: colors.textSecondary,
    },
  });
