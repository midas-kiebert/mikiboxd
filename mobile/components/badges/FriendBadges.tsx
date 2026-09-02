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
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import type { UserPublic, UserWithFriendStatus } from "shared";

import { ThemedText } from "@/components/themed-text";
import { useSingleFireNavigation } from "@/hooks/useSingleFireNavigation";
import { useThemeColors } from "@/hooks/use-theme-color";

type FriendBadgesProps = {
  friendsGoing?: UserPublic[];
  friendsInterested?: UserPublic[];
  /** Friends you invited who haven't responded yet — shown last, muted/dashed. */
  friendsPending?: UserPublic[];
  /**
   * Friends of the viewer's friends, reachable only through a mutual friend —
   * never the viewer's own friends, so they render with the same dashed
   * "not really your circle" border as `friendsPending` and a "+" instead of
   * the remind bell (see `onAddFriend`).
   */
  friendsOfFriendsGoing?: UserWithFriendStatus[];
  friendsOfFriendsInterested?: UserWithFriendStatus[];
  variant?: "compact" | "default";
  maxVisible?: number;
  maxRows?: number;
  style?: StyleProp<ViewStyle>;
  disabledUserId?: string;
  /** Called right before navigating to a friend's page (e.g. to close an open sheet first). */
  onNavigate?: () => void;
  /**
   * When given, interested badges (not going — see nextfix.md) grow a small
   * "remind" bell so a friend who's already interested can still be nudged,
   * without offering a duplicate invite. Omitted everywhere badges are just a
   * read-only audience summary (movie cards, compact rows).
   */
  onRemindFriend?: (friendId: string, name: string) => void;
  remindedFriendIds?: Set<string>;
  remindDisabled?: boolean;
  /**
   * Friends who can't currently see the viewer's own status on this showtime
   * (their visibility mode or a per-friend opt-out hides it) — their remind
   * bell is suppressed, since nudging someone about a showtime they can't
   * see the viewer is attending would out that attendance without the
   * viewer having chosen to share it.
   */
  hiddenFromFriendIds?: Set<string>;
  /** Opens the add/accept-friend popup for a friend-of-friend badge's "+". */
  onAddFriend?: (user: UserWithFriendStatus) => void;
};

type FriendBadgeProps = {
  badgeKey: string;
  friendId: string;
  name: string;
  seatLabel?: string | null;
  backgroundColor: string;
  /** Outline tone. Separate from {@link accentColor} so the badge can be readable
   *  without being outlined in the same ink as its label. */
  borderColor: string;
  accentColor: string;
  styles: ReturnType<typeof createStyles>;
  variant: "compact" | "default";
  onMeasureWidth?: (badgeKey: string, width: number) => void;
  disabledUserId?: string;
  onNavigate?: () => void;
  onRemind?: () => void;
  reminded?: boolean;
  remindDisabled?: boolean;
  remindIconColor?: string;
  remindIconColorSent?: string;
  onAdd?: () => void;
  isFriendOfFriend?: boolean;
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
  borderColor: string;
  accentColor: string;
  isPending?: boolean;
  isInterested?: boolean;
  isFriendOfFriend?: boolean;
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
  borderColor,
  accentColor,
  styles,
  variant,
  onMeasureWidth,
  disabledUserId,
  onNavigate,
  isPending,
  onRemind,
  reminded,
  remindDisabled,
  remindIconColor,
  remindIconColorSent,
  onAdd,
  isFriendOfFriend,
}: FriendBadgeProps & { isPending?: boolean }) => {
  const router = useRouter();
  const goToFriendShowtimes = useSingleFireNavigation((id: string, friendName: string) =>
    router.push({ pathname: "/friend-showtimes/[id]", params: { id, name: friendName } })
  );
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
  const actionButtonStyle =
    variant === "compact" ? styles.actionButtonCompact : styles.actionButtonDefault;
  const actionIconSize = variant === "compact" ? 11 : 14;

  const handlePress = (event: GestureResponderEvent) => {
    if (disabledUserId !== undefined && friendId === disabledUserId) return;
    event.stopPropagation();
    // Same destination as any other friend badge — `/friend-showtimes/[id]`
    // already renders `NonFriendProfile` (with a friend-request control, plus
    // Block/Report) whenever the viewer and this person aren't friends yet,
    // so a friend-of-friend's own page is just as reachable. The "+" stays
    // its own tap target for the quick add/accept popup, not a substitute
    // for getting to their page.
    onNavigate?.();
    goToFriendShowtimes(friendId, name);
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
        { backgroundColor, borderColor },
        (isPending || isFriendOfFriend) && styles.pendingBadge,
      ]}
    >
      <View
        style={[
          styles.statusDot,
          sizeStyles.statusDot,
          isPending || isFriendOfFriend
            ? { backgroundColor: "transparent", borderWidth: 1, borderColor: accentColor }
            : { backgroundColor: accentColor },
        ]}
      />
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
      {onRemind ? (
        <TouchableOpacity
          onPress={(event) => {
            event.stopPropagation();
            if (reminded || remindDisabled) return;
            onRemind();
          }}
          disabled={reminded || remindDisabled}
          hitSlop={FRIEND_BADGE_HIT_SLOP}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={reminded ? `Reminder sent to ${name}` : `Send ${name} a reminder`}
          style={[actionButtonStyle, reminded && styles.remindButtonSent]}
        >
          <MaterialIcons
            name="notifications-none"
            size={actionIconSize}
            color={reminded ? remindIconColorSent : remindIconColor}
          />
        </TouchableOpacity>
      ) : null}
      {onAdd ? (
        <TouchableOpacity
          onPress={(event) => {
            event.stopPropagation();
            onAdd();
          }}
          hitSlop={FRIEND_BADGE_HIT_SLOP}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={`Add ${name} as a friend`}
          style={actionButtonStyle}
        >
          <MaterialIcons name="add" size={actionIconSize} color={accentColor} />
        </TouchableOpacity>
      ) : null}
    </TouchableOpacity>
  );
};

export default function FriendBadges({
  friendsGoing = [],
  friendsInterested = [],
  friendsPending = [],
  friendsOfFriendsGoing = [],
  friendsOfFriendsInterested = [],
  variant = "default",
  maxVisible,
  maxRows,
  style,
  disabledUserId,
  onNavigate,
  onRemindFriend,
  remindedFriendIds,
  remindDisabled,
  hiddenFromFriendIds,
  onAddFriend,
}: FriendBadgesProps) {
  // Read flow: props/state setup first, then helper handlers, then returned JSX.
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const [containerWidth, setContainerWidth] = useState(0);
  const [measuredBadgeWidths, setMeasuredBadgeWidths] = useState<Record<string, number>>({});
  const [overflowBadgeWidth, setOverflowBadgeWidth] = useState(0);

  // Each badge carries its own hue in the fill. Previously every badge was the same
  // neutral pill and only the label was coloured, which forced the label dark enough
  // to clear 4.5:1 against that neutral — the reason going/interested read as heavy.
  const items: BadgeItem[] = [
    ...friendsGoing.map((friend) => ({
      key: `going-${friend.id}`,
      friend,
      backgroundColor: colors.friendGoing.primary,
      borderColor: colors.friendGoing.border,
      accentColor: colors.friendGoing.secondary,
    })),
    ...friendsInterested.map((friend) => ({
      key: `interested-${friend.id}`,
      friend,
      backgroundColor: colors.friendInterested.primary,
      borderColor: colors.friendInterested.border,
      accentColor: colors.friendInterested.secondary,
      isInterested: true,
    })),
    ...friendsPending.map((friend) => ({
      key: `pending-${friend.id}`,
      friend,
      backgroundColor: colors.surfaceMuted,
      borderColor: colors.gray.border,
      accentColor: colors.textSecondary,
      isPending: true,
    })),
    ...friendsOfFriendsGoing.map((friend) => ({
      key: `fof-going-${friend.id}`,
      friend,
      backgroundColor: colors.friendGoing.primary,
      borderColor: colors.friendGoing.border,
      accentColor: colors.friendGoing.secondary,
      isFriendOfFriend: true,
    })),
    ...friendsOfFriendsInterested.map((friend) => ({
      key: `fof-interested-${friend.id}`,
      friend,
      backgroundColor: colors.friendInterested.primary,
      borderColor: colors.friendInterested.border,
      accentColor: colors.friendInterested.secondary,
      isInterested: true,
      isFriendOfFriend: true,
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
      {visibleItems.map(
        ({
          key,
          friend,
          backgroundColor,
          borderColor,
          accentColor,
          isPending,
          isInterested,
          isFriendOfFriend,
        }) => (
          <FriendBadge
            key={key}
            badgeKey={key}
            friendId={friend.id}
            name={getFriendName(friend)}
            seatLabel={isPending || isFriendOfFriend ? null : getSeatLabel(friend)}
            backgroundColor={backgroundColor}
            borderColor={borderColor}
            accentColor={accentColor}
            styles={styles}
            variant={variant}
            onMeasureWidth={handleMeasureBadgeWidth}
            disabledUserId={disabledUserId}
            onNavigate={onNavigate}
            isPending={isPending}
            isFriendOfFriend={isFriendOfFriend}
            onRemind={
              !isFriendOfFriend &&
              isInterested &&
              onRemindFriend &&
              !hiddenFromFriendIds?.has(friend.id)
                ? () => onRemindFriend(friend.id, getFriendName(friend))
                : undefined
            }
            reminded={remindedFriendIds?.has(friend.id)}
            remindDisabled={remindDisabled}
            remindIconColor={accentColor}
            remindIconColorSent={colors.textSecondary}
            onAdd={
              isFriendOfFriend && onAddFriend
                ? () => onAddFriend(friend as UserWithFriendStatus)
                : undefined
            }
          />
        )
      )}
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
    // Sized to fit inside the badge's own height rather than to the glyph: at
    // 18 the button plus the badge's vertical padding came to 20, two points
    // over `defaultBadge`'s 18, so a badge carrying an action stood taller
    // than the plain ones beside it.
    actionButtonDefault: {
      width: 16,
      height: 16,
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
    },
    actionButtonCompact: {
      width: 12,
      height: 12,
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
    },
    remindButtonSent: {},
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
    pendingBadge: {
      borderStyle: "dashed",
      opacity: 0.85,
    },
    overflowBadge: {
      backgroundColor: colors.surfaceMuted,
      justifyContent: "center",
    },
    overflowBadgeText: {
      color: colors.textSecondary,
    },
  });
