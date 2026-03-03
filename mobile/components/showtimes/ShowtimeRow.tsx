/**
 * Mobile showtimes feature component: Showtime Row.
 */
import { StyleSheet, View } from "react-native";
import { DateTime } from "luxon";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type { CinemaPublic, UserPublic } from "shared";

import { ThemedText } from "@/components/themed-text";
import CinemaPill from "@/components/badges/CinemaPill";
import FriendBadges from "@/components/badges/FriendBadges";
import { useThemeColors } from "@/hooks/use-theme-color";
import { useShowtimeVisibilityIndicator } from "@/hooks/use-showtime-visibility-indicator";
import { formatShowtimeTimeRange } from "@/utils/showtime-time";

type ShowtimeBase = {
  id?: number;
  datetime: string;
  end_datetime?: string | null;
  seat_row?: string | null;
  seat_number?: string | null;
  cinema: CinemaPublic;
  friends_going?: UserPublic[];
  friends_interested?: UserPublic[];
};

type ShowtimeRowProps = {
  showtime: ShowtimeBase;
  variant?: "compact" | "default";
  showFriends?: boolean;
  alignCinemaRight?: boolean;
  showDate?: boolean;
  showVisibilityHint?: boolean;
};

const formatShowtime = (
  datetime: string,
  endDatetime: string | null | undefined,
  showDate: boolean
) => {
  const timeLabel = formatShowtimeTimeRange(datetime, endDatetime);
  if (!showDate) return timeLabel;
  const dateFormat = "ccc d LLL";
  const dateLabel = DateTime.fromISO(datetime).toFormat(dateFormat);
  return `${dateLabel} • ${timeLabel}`;
};

export default function ShowtimeRow({
  showtime,
  variant = "default",
  showFriends = false,
  alignCinemaRight = false,
  showDate = true,
  showVisibilityHint = false,
}: ShowtimeRowProps) {
  // Read flow: props/state setup first, then helper handlers, then returned JSX.
  const colors = useThemeColors();
  const styles = createStyles(colors);
  // Compact mode is used in dense cards; default mode is used in full showtime lists.
  const isCompact = variant === "compact";
  const visibilityIndicator = useShowtimeVisibilityIndicator({
    showtimeId: showtime.id,
    enabled: showVisibilityHint,
  });

  // Render/output using the state and derived values prepared above.
  return (
    <View style={[styles.container, isCompact ? styles.compactContainer : styles.defaultContainer]}>
      <View style={[styles.header, alignCinemaRight && styles.headerRightAligned]}>
        <ThemedText
          style={[
            styles.time,
            isCompact ? styles.timeCompact : styles.timeDefault,
            alignCinemaRight && styles.timeRightAligned,
          ]}
          numberOfLines={1}
        >
          {formatShowtime(showtime.datetime, showtime.end_datetime, showDate)}
        </ThemedText>
        {showVisibilityHint && visibilityIndicator?.kind === "none" ? (
          <MaterialCommunityIcons
            name="incognito"
            size={8}
            color={colors.textSecondary}
            style={styles.visibilityHintIcon}
          />
        ) : null}
        {showVisibilityHint && visibilityIndicator?.kind === "label" ? (
          <ThemedText style={styles.visibilityHintText} numberOfLines={1}>
            {visibilityIndicator.label}
          </ThemedText>
        ) : null}
        <CinemaPill cinema={showtime.cinema} variant={isCompact ? "compact" : "default"} />
      </View>
      {showFriends ? (
        <FriendBadges
          friendsGoing={showtime.friends_going}
          friendsInterested={showtime.friends_interested}
          variant={isCompact ? "compact" : "default"}
          style={styles.friendRow}
        />
      ) : null}
    </View>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    container: {
      gap: 4,
    },
    compactContainer: {
      gap: 2,
    },
    defaultContainer: {
      gap: 6,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    headerRightAligned: {
      justifyContent: "space-between",
    },
    time: {
      color: colors.text,
      flexShrink: 1,
    },
    timeRightAligned: {
      flex: 1,
      minWidth: 0,
    },
    timeCompact: {
      fontSize: 11,
      lineHeight: 13,
    },
    timeDefault: {
      fontSize: 13,
      lineHeight: 16,
    },
    visibilityHintText: {
      fontSize: 8,
      lineHeight: 9,
      color: colors.textSecondary,
      maxWidth: 90,
    },
    visibilityHintIcon: {
      marginTop: 1,
    },
    friendRow: {
      marginTop: 3,
    },
  });
