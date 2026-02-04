import { StyleSheet, View } from "react-native";
import { DateTime } from "luxon";
import type { CinemaPublic, UserPublic } from "shared";

import { ThemedText } from "@/components/themed-text";
import CinemaPill from "@/components/badges/CinemaPill";
import FriendBadges from "@/components/badges/FriendBadges";
import { useThemeColors } from "@/hooks/use-theme-color";

type ShowtimeBase = {
  datetime: string;
  cinema: CinemaPublic;
  friends_going?: UserPublic[];
  friends_interested?: UserPublic[];
};

type ShowtimeRowProps = {
  showtime: ShowtimeBase;
  variant?: "compact" | "default";
  showFriends?: boolean;
};

const formatShowtime = (datetime: string) =>
  DateTime.fromISO(datetime).toFormat("ccc, LLL d, HH:mm");

export default function ShowtimeRow({
  showtime,
  variant = "default",
  showFriends = false,
}: ShowtimeRowProps) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const isCompact = variant === "compact";

  return (
    <View style={[styles.container, isCompact ? styles.compactContainer : styles.defaultContainer]}>
      <View style={styles.header}>
        <ThemedText
          style={[styles.time, isCompact ? styles.timeCompact : styles.timeDefault]}
          numberOfLines={1}
        >
          {formatShowtime(showtime.datetime)}
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
    time: {
      color: colors.text,
      flexShrink: 1,
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
      marginTop: 2,
    },
  });
