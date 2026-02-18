/**
 * Mobile showtimes feature component: Showtime Card.
 */
import { Image, StyleSheet, TouchableOpacity, View } from "react-native";
import { DateTime } from "luxon";
import { useRouter } from "expo-router";
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
  // Read flow: props/state setup first, then helper handlers, then returned JSX.
  const router = useRouter();
  // Read the active theme color tokens used by this screen/component.
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const date = DateTime.fromISO(showtime.datetime);
  const weekday = date.toFormat("ccc");
  const day = date.toFormat("d");
  const month = date.toFormat("LLL");
  const time = date.toFormat("HH:mm");
  const cardStatusStyle =
    showtime.going === "GOING"
      ? styles.cardGoing
      : showtime.going === "INTERESTED"
        ? styles.cardInterested
        : undefined;
  const cardGlowStyle =
    showtime.going === "GOING"
      ? styles.cardGlowGoing
      : showtime.going === "INTERESTED"
        ? styles.cardGlowInterested
        : undefined;
  const dateColumnStatusStyle =
    showtime.going === "GOING"
      ? styles.dateColumnGoing
      : showtime.going === "INTERESTED"
        ? styles.dateColumnInterested
        : undefined;
  // Handle press behavior for this module.
  const handlePress = () => {
    if (onPress) {
      onPress(showtime);
      return;
    }
    router.push(`/movie/${showtime.movie.id}`);
  };

  // Render/output using the state and derived values prepared above.
  return (
    <View style={[styles.cardGlow, cardGlowStyle]}>
      <TouchableOpacity
        style={[styles.card, cardStatusStyle]}
        onPress={handlePress}
        activeOpacity={0.8}
      >
        <View style={[styles.dateColumn, dateColumnStatusStyle]}>
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
    </View>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    cardGlow: {
      marginBottom: 16,
      borderRadius: 12,
      backgroundColor: colors.cardBackground,
    },
    cardGlowGoing: {
      shadowColor: colors.green.secondary,
      shadowOpacity: 0.6,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
      elevation: 8,
    },
    cardGlowInterested: {
      shadowColor: colors.orange.secondary,
      shadowOpacity: 0.6,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
      elevation: 8,
    },
    card: {
      flexDirection: "row",
      backgroundColor: colors.cardBackground,
      borderRadius: 12,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: colors.cardBorder,
      minHeight: POSTER_HEIGHT,
    },
    cardGoing: {
      borderColor: colors.green.secondary,
      backgroundColor: colors.green.primary,
    },
    cardInterested: {
      borderColor: colors.orange.secondary,
      backgroundColor: colors.orange.primary,
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
    dateColumnGoing: {
      backgroundColor: colors.green.primary,
      borderRightColor: colors.green.secondary,
    },
    dateColumnInterested: {
      backgroundColor: colors.orange.primary,
      borderRightColor: colors.orange.secondary,
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
