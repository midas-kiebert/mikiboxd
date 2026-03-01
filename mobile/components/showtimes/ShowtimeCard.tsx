/**
 * Mobile showtimes feature component: Showtime Card.
 */
import { Image, Platform, StyleSheet, TouchableOpacity, View } from "react-native";
import { useRef } from "react";
import { DateTime } from "luxon";
import { useRouter } from "expo-router";
import type { ShowtimeLoggedIn } from "shared";

import { ThemedText } from "@/components/themed-text";
import CinemaPill from "@/components/badges/CinemaPill";
import FriendBadges from "@/components/badges/FriendBadges";
import { createShowtimeStatusGlowStyles } from "@/components/showtimes/showtime-glow";
import { useThemeColors } from "@/hooks/use-theme-color";
import {
  GLOBAL_LONG_PRESS_DELAY_MS,
  triggerLongPressHaptic,
} from "@/utils/long-press";

type ShowtimeCardProps = {
  showtime: ShowtimeLoggedIn;
  onPress?: (showtime: ShowtimeLoggedIn) => void;
  onLongPress?: (showtime: ShowtimeLoggedIn) => void;
};

const POSTER_HEIGHT = 112;

export default function ShowtimeCard({ showtime, onPress, onLongPress }: ShowtimeCardProps) {
  // Read flow: props/state setup first, then helper handlers, then returned JSX.
  const router = useRouter();
  const suppressNextPressRef = useRef(false);
  // Read the active theme color tokens used by this screen/component.
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const date = DateTime.fromISO(showtime.datetime);
  const weekday = date.toFormat("ccc");
  const day = date.toFormat("d");
  const month = date.toFormat("LLL");
  const startTime = date.toFormat("HH:mm");
  const endDate = showtime.end_datetime ? DateTime.fromISO(showtime.end_datetime) : null;
  const endTime = endDate?.isValid ? endDate.toFormat("HH:mm") : null;
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
    if (suppressNextPressRef.current) {
      suppressNextPressRef.current = false;
      return;
    }
    if (onPress) {
      onPress(showtime);
      return;
    }
    router.push(`/movie/${showtime.movie.id}`);
  };

  const handleLongPress = () => {
    if (!onLongPress) return;
    suppressNextPressRef.current = true;
    triggerLongPressHaptic();
    onLongPress(showtime);
  };

  const handlePressOut = () => {
    if (!suppressNextPressRef.current) return;
    // Clear right after the current gesture cycle to avoid slowing the next tap.
    requestAnimationFrame(() => {
      suppressNextPressRef.current = false;
    });
  };

  // Render/output using the state and derived values prepared above.
  return (
    <View style={[styles.cardGlow, cardGlowStyle]}>
      <TouchableOpacity
        style={[styles.card, cardStatusStyle]}
        onPress={handlePress}
        onLongPress={onLongPress ? handleLongPress : undefined}
        delayLongPress={GLOBAL_LONG_PRESS_DELAY_MS}
        onPressOut={onLongPress ? handlePressOut : undefined}
        activeOpacity={0.8}
      >
        <View style={[styles.dateColumn, dateColumnStatusStyle]}>
          <ThemedText style={styles.weekday}>{weekday}</ThemedText>
          <ThemedText style={styles.day}>{day}</ThemedText>
          <ThemedText style={styles.month}>{month}</ThemedText>
          <ThemedText style={styles.time}>
            <ThemedText style={styles.timeStart}>{startTime}</ThemedText>
            {endTime ? <ThemedText style={styles.timeEnd}>{`~${endTime}`}</ThemedText> : null}
          </ThemedText>
        </View>
        <Image
          source={{ uri: showtime.movie.poster_link ?? undefined }}
          style={styles.poster}
        />
        <View style={styles.info}>
          <View style={styles.titleRow}>
            <ThemedText style={styles.title} numberOfLines={2} ellipsizeMode="tail">
              {showtime.movie.title}
            </ThemedText>
            <CinemaPill cinema={showtime.cinema} variant="compact" />
          </View>
          <FriendBadges
            friendsGoing={showtime.friends_going}
            friendsInterested={showtime.friends_interested}
            variant="compact"
            maxVisible={2}
            style={styles.friendRow}
          />
        </View>
      </TouchableOpacity>
    </View>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) => {
  const glowStyles = createShowtimeStatusGlowStyles(colors);
  return StyleSheet.create({
    cardGlow: {
      marginBottom: 16,
      borderRadius: 12,
      backgroundColor: colors.cardBackground,
    },
    cardGlowGoing: glowStyles.going,
    cardGlowInterested: glowStyles.interested,
    card: {
      flexDirection: "row",
      backgroundColor: colors.cardBackground,
      borderRadius: 12,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: colors.cardBorder,
      height: POSTER_HEIGHT,
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
      width: 74,
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
      fontSize: 13,
      fontWeight: "700",
      color: colors.textSecondary,
      textTransform: "uppercase",
      letterSpacing: 0.6,
    },
    day: {
      fontSize: 26,
      fontWeight: "800",
      color: colors.text,
      lineHeight: 28,
    },
    month: {
      fontSize: 13,
      fontWeight: "700",
      color: colors.textSecondary,
      textTransform: "uppercase",
      letterSpacing: 0.6,
    },
    time: {
      fontSize: 10,
      lineHeight: 12,
      fontWeight: "700",
      color: colors.text,
    },
    timeStart: {
      fontSize: 11,
      lineHeight: 13,
      fontWeight: "700",
      color: colors.text,
    },
    timeEnd: {
      fontSize: 8,
      lineHeight: 10,
      fontWeight: "700",
      color: colors.textSecondary,
    },
    poster: {
      width: 72,
      height: "100%",
      backgroundColor: colors.posterPlaceholder,
    },
    info: {
      flex: 1,
      paddingHorizontal: 10,
      paddingVertical: 8,
      gap: 4,
      overflow: "hidden",
    },
    titleRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      columnGap: 6,
      flexWrap: "nowrap",
    },
    title: {
      fontSize: Platform.OS === "ios" ? 14 : 15,
      lineHeight: Platform.OS === "ios" ? 16 : 17,
      fontWeight: "700",
      color: colors.text,
      flex: 1,
      minWidth: 0,
    },
    friendRow: {
      marginTop: 2,
    },
  });
};
