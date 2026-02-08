import { Image, StyleSheet, TouchableOpacity, View } from "react-native";
import { DateTime } from "luxon";
import type { ShowtimeLoggedIn } from "shared";

import { ThemedText } from "@/components/themed-text";
import CinemaPill from "@/components/badges/CinemaPill";
import FriendBadges from "@/components/badges/FriendBadges";
import { useThemeColors } from "@/hooks/use-theme-color";

type ShowtimeCardProps = {
  showtime: ShowtimeLoggedIn;
  onPress?: (showtime: ShowtimeLoggedIn) => void;
};

const POSTER_HEIGHT = 112;

export default function ShowtimeCard({ showtime, onPress }: ShowtimeCardProps) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const date = DateTime.fromISO(showtime.datetime);
  const weekday = date.toFormat("ccc");
  const day = date.toFormat("d");
  const month = date.toFormat("LLL");
  const time = date.toFormat("HH:mm");

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => onPress?.(showtime)}
      activeOpacity={0.8}
    >
      <View style={styles.dateColumn}>
        <ThemedText style={styles.weekday}>{weekday}</ThemedText>
        <ThemedText style={styles.day}>{day}</ThemedText>
        <ThemedText style={styles.month}>{month}</ThemedText>
        <ThemedText style={styles.time}>{time}</ThemedText>
      </View>
      <Image
        source={{ uri: showtime.movie.poster_link ?? undefined }}
        style={styles.poster}
      />
      <View style={styles.info}>
        <View style={styles.titleRow}>
          <ThemedText style={styles.title} numberOfLines={1} ellipsizeMode="tail">
            {showtime.movie.title}
          </ThemedText>
          <CinemaPill cinema={showtime.cinema} variant="compact" />
        </View>
        <FriendBadges
          friendsGoing={showtime.friends_going}
          friendsInterested={showtime.friends_interested}
          variant="compact"
          style={styles.friendRow}
        />
      </View>
    </TouchableOpacity>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    card: {
      flexDirection: "row",
      backgroundColor: colors.cardBackground,
      borderRadius: 12,
      marginBottom: 16,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: colors.cardBorder,
      minHeight: POSTER_HEIGHT,
    },
    dateColumn: {
      width: 56,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.pillBackground,
      borderRightWidth: 1,
      borderRightColor: colors.cardBorder,
      paddingVertical: 8,
      gap: 2,
    },
    weekday: {
      fontSize: 12,
      fontWeight: "700",
      color: colors.textSecondary,
      textTransform: "uppercase",
      letterSpacing: 0.6,
    },
    day: {
      fontSize: 24,
      fontWeight: "800",
      color: colors.text,
      lineHeight: 26,
    },
    month: {
      fontSize: 12,
      fontWeight: "700",
      color: colors.textSecondary,
      textTransform: "uppercase",
      letterSpacing: 0.6,
    },
    time: {
      fontSize: 12,
      fontWeight: "700",
      color: colors.text,
    },
    poster: {
      width: 72,
      height: POSTER_HEIGHT,
      backgroundColor: colors.posterPlaceholder,
    },
    info: {
      flex: 1,
      paddingHorizontal: 10,
      paddingVertical: 6,
      gap: 6,
    },
    titleRow: {
      flexDirection: "row",
      alignItems: "center",
      columnGap: 6,
      rowGap: 4,
      flexWrap: "wrap",
    },
    title: {
      fontSize: 15,
      fontWeight: "700",
      color: colors.text,
      flexShrink: 0,
      maxWidth: "100%",
    },
    friendRow: {
      marginTop: 2,
    },
  });
