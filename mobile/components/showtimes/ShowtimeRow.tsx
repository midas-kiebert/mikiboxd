/**
 * Mobile showtimes feature component: Showtime Row.
 */
import { StyleSheet, View } from "react-native";
import { DateTime } from "luxon";
import type { CinemaPublic, UserPublic } from "shared";

import { ThemedText } from "@/components/themed-text";
import CinemaPill from "@/components/badges/CinemaPill";
import FriendBadges from "@/components/badges/FriendBadges";
import { useThemeColors } from "@/hooks/use-theme-color";
import { formatShowtimeTimeRange } from "@/utils/showtime-time";

type ShowtimeBase = {
  datetime: string;
  end_datetime?: string | null;
  cinema: CinemaPublic;
  friends_going?: UserPublic[];
  friends_interested?: UserPublic[];
};

type ShowtimeRowProps = {
  showtime: ShowtimeBase;
  variant?: "compact" | "default";
  showFriends?: boolean;
  alignCinemaRight?: boolean;
};

const formatShowtime = (
  datetime: string,
  endDatetime: string | null | undefined
) => {
  const dateFormat = "ccc d LLL";
  const dateLabel = DateTime.fromISO(datetime).toFormat(dateFormat);
  const timeLabel = formatShowtimeTimeRange(datetime, endDatetime);
  return `${dateLabel} • ${timeLabel}`;
};

export default function ShowtimeRow({
  showtime,
  variant = "default",
  showFriends = false,
  alignCinemaRight = false,
}: ShowtimeRowProps) {
  // Read flow: props/state setup first, then helper handlers, then returned JSX.
  const colors = useThemeColors();
  const styles = createStyles(colors);
  // Compact mode is used in dense cards; default mode is used in full showtime lists.
  const isCompact = variant === "compact";

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
          {formatShowtime(showtime.datetime, showtime.end_datetime)}
        </ThemedText>
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
    friendRow: {
      marginTop: 3,
    },
  });
