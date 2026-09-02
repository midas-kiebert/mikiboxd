/**
 * Mobile showtimes feature component: Showtime Row.
 */
import { StyleSheet, View } from "react-native";
import { DateTime } from "luxon";
import type { CinemaPublic, GoingStatus, UserPublic, UserWithFriendStatus } from "shared";

import { ThemedText } from "@/components/themed-text";
import CinemaPill from "@/components/badges/CinemaPill";
import SubtitlesBadges from "@/components/badges/SubtitlesBadges";
import FriendBadges from "@/components/badges/FriendBadges";
import SeatAvailabilityBadge from "@/components/badges/SeatAvailabilityBadge";
import { useThemeColors } from "@/hooks/use-theme-color";
import { Fonts } from "@/constants/theme";
import { formatShowtimeTimeRange } from "@/utils/showtime-time";

type ShowtimeBase = {
  id?: number;
  datetime: string;
  end_datetime?: string | null;
  going?: GoingStatus;
  seat_row?: string | null;
  seat_number?: string | null;
  cinema: CinemaPublic;
  subtitles?: string[] | null;
  viewer?: {
    friends_going?: UserPublic[];
    friends_interested?: UserPublic[];
    pending_invited_friends?: UserPublic[];
    friends_of_friends_going?: UserWithFriendStatus[];
    friends_of_friends_interested?: UserWithFriendStatus[];
  } | null;
};

type ShowtimeRowProps = {
  showtime: ShowtimeBase;
  variant?: "compact" | "default";
  showFriends?: boolean;
  alignCinemaRight?: boolean;
  showDate?: boolean;
  subtitlesAfterCinema?: boolean;
  isSyntheticMovie?: boolean;
  showCinema?: boolean;
  // Off inside a movie card: that row is too dense to spare space for the end time.
  showEndTime?: boolean;
  // Off inside a movie card: that row has no space to spare for a seat count.
  showSeatAvailability?: boolean;
  // Icon only, no count: still enough to glance at inside a movie card.
  seatAvailabilityIconOnly?: boolean;
  // Only the levels worth hurrying for: a calm room is not news on a dense row.
  seatAvailabilityUrgentOnly?: boolean;
  // Widths measured across a set of sibling rows (by the parent list), fed
  // back in so each date segment and the block before the cinema pill line
  // up at the widest row's edge instead of each row's own content width.
  dateColumnWidths?: DateColumnWidths;
  leadingColumnWidth?: number;
  onMeasureDateColumnWidth?: (segment: DateSegment, width: number) => void;
  onMeasureLeadingWidth?: (width: number) => void;
  /**
   * Opens the add/accept-friend popup for a friend-of-friend badge's "+".
   * Omitted where the row is only a summary to glance at (inside a movie
   * card), which is also what leaves the "+" off those rows.
   */
  onAddFriend?: (user: UserWithFriendStatus) => void;
};

type DateSegment = "weekday" | "day" | "month";
type DateColumnWidths = Partial<Record<DateSegment, number>>;

const buildTimeParts = (
  datetime: string,
  endDatetime: string | null | undefined,
  showDate: boolean,
  isSyntheticMovie: boolean
) => {
  const timeLabel = formatShowtimeTimeRange(datetime, endDatetime, isSyntheticMovie);
  if (!showDate) return { weekdayLabel: null, dayLabel: null, monthLabel: null, timeLabel };
  const start = DateTime.fromISO(datetime);
  return {
    weekdayLabel: start.toFormat("ccc").toUpperCase(),
    dayLabel: start.toFormat("d"),
    monthLabel: start.toFormat("LLL").toUpperCase(),
    timeLabel,
  };
};

export default function ShowtimeRow({
  showtime,
  variant = "default",
  showFriends = false,
  alignCinemaRight = false,
  showDate = true,
  subtitlesAfterCinema = false,
  isSyntheticMovie = false,
  showCinema = true,
  showEndTime = true,
  showSeatAvailability = true,
  seatAvailabilityIconOnly = false,
  seatAvailabilityUrgentOnly = false,
  dateColumnWidths,
  leadingColumnWidth,
  onMeasureDateColumnWidth,
  onMeasureLeadingWidth,
  onAddFriend,
}: ShowtimeRowProps) {
  // Read flow: props/state setup first, then helper handlers, then returned JSX.
  const colors = useThemeColors();
  const styles = createStyles(colors);
  // Compact mode is used in dense cards; default mode is used in full showtime lists.
  const isCompact = variant === "compact";
  const { weekdayLabel, dayLabel, monthLabel, timeLabel } = buildTimeParts(
    showtime.datetime,
    showEndTime ? showtime.end_datetime : null,
    showDate,
    showEndTime && isSyntheticMovie
  );
  const timeTextStyle = [styles.time, isCompact ? styles.timeCompact : styles.timeDefault];
  const subtitlesBadges = (
    <SubtitlesBadges subtitles={showtime.subtitles} variant={isCompact ? "compact" : "default"} />
  );
  const cinemaPill = showCinema ? (
    <CinemaPill cinema={showtime.cinema} variant={isCompact ? "compact" : "default"} />
  ) : null;
  // Renders nothing unless this showtime's availability is already cached, so
  // rows that have no reading keep exactly the layout they had before.
  const seatBadge = showSeatAvailability ? (
    <SeatAvailabilityBadge
      showtimeId={showtime.id}
      variant={isCompact ? "compact" : "default"}
      iconOnly={seatAvailabilityIconOnly}
      urgentOnly={seatAvailabilityUrgentOnly}
    />
  ) : null;

  // Render/output using the state and derived values prepared above.
  return (
    <View style={[styles.container, isCompact ? styles.compactContainer : styles.defaultContainer]}>
      <View style={[styles.header, alignCinemaRight && styles.headerRightAligned]}>
        <View
          style={[
            styles.leadingBlock,
            alignCinemaRight && styles.timeRightAligned,
            leadingColumnWidth ? { minWidth: leadingColumnWidth } : null,
          ]}
          onLayout={
            onMeasureLeadingWidth
              ? (event) => onMeasureLeadingWidth(event.nativeEvent.layout.width)
              : undefined
          }
        >
          {weekdayLabel ? (
            <>
              <ThemedText
                style={[
                  timeTextStyle,
                  styles.dateMono,
                  styles.dateGray,
                  dateColumnWidths?.weekday ? { minWidth: dateColumnWidths.weekday } : null,
                ]}
                numberOfLines={1}
                onLayout={
                  onMeasureDateColumnWidth
                    ? (event) => onMeasureDateColumnWidth("weekday", event.nativeEvent.layout.width)
                    : undefined
                }
              >
                {weekdayLabel}
              </ThemedText>
              <View style={styles.weekdayDaySpacer} />
              <ThemedText
                style={[
                  timeTextStyle,
                  styles.dateMono,
                  styles.dateRight,
                  dateColumnWidths?.day ? { minWidth: dateColumnWidths.day } : null,
                ]}
                numberOfLines={1}
                onLayout={
                  onMeasureDateColumnWidth
                    ? (event) => onMeasureDateColumnWidth("day", event.nativeEvent.layout.width)
                    : undefined
                }
              >
                {dayLabel}
              </ThemedText>
              <ThemedText style={timeTextStyle} numberOfLines={1}>
                {" "}
              </ThemedText>
              <ThemedText
                style={[
                  timeTextStyle,
                  styles.dateMono,
                  styles.dateGray,
                  dateColumnWidths?.month ? { minWidth: dateColumnWidths.month } : null,
                ]}
                numberOfLines={1}
                onLayout={
                  onMeasureDateColumnWidth
                    ? (event) => onMeasureDateColumnWidth("month", event.nativeEvent.layout.width)
                    : undefined
                }
              >
                {monthLabel}
              </ThemedText>
              <ThemedText style={timeTextStyle} numberOfLines={1}>
                {" • "}
              </ThemedText>
            </>
          ) : null}
          <ThemedText style={timeTextStyle} numberOfLines={1}>
            {timeLabel}
          </ThemedText>
        </View>
        {subtitlesAfterCinema ? (
          <>
            {cinemaPill}
            {subtitlesBadges}
            {seatBadge}
          </>
        ) : (
          <>
            {subtitlesBadges}
            {seatBadge}
            {cinemaPill}
          </>
        )}
      </View>
      {showFriends ? (
        <FriendBadges
          friendsGoing={showtime.viewer?.friends_going}
          friendsInterested={showtime.viewer?.friends_interested}
          friendsPending={showtime.viewer?.pending_invited_friends}
          friendsOfFriendsGoing={showtime.viewer?.friends_of_friends_going}
          friendsOfFriendsInterested={showtime.viewer?.friends_of_friends_interested}
          variant={isCompact ? "compact" : "default"}
          style={styles.friendRow}
          onAddFriend={onAddFriend}
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
    leadingBlock: {
      flexDirection: "row",
      alignItems: "center",
    },
    time: {
      color: colors.text,
      flexShrink: 1,
    },
    dateMono: {
      fontFamily: Fonts?.mono,
      fontWeight: "600",
    },
    dateGray: {
      color: colors.textSecondary,
    },
    dateRight: {
      textAlign: "right",
    },
    weekdayDaySpacer: {
      width: 2,
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
