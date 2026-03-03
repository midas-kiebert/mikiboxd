/**
 * Mobile movies feature component: Movie Card.
 */
import {
  Image,
  Platform,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import { useMemo, useState } from "react";

import { DateTime } from "luxon";
import type { MovieSummaryLoggedIn } from "shared";

import { ThemedText } from "@/components/themed-text";
import FriendBadges from "@/components/badges/FriendBadges";
import ShowtimeRow from "@/components/showtimes/ShowtimeRow";
import { createShowtimeStatusGlowStyles } from "@/components/showtimes/showtime-glow";
import { useThemeColors } from "@/hooks/use-theme-color";

type MovieCardProps = {
  movie: MovieSummaryLoggedIn;
  onPress?: (movie: MovieSummaryLoggedIn) => void;
};

const MAX_SHOWTIMES = 5;
const POSTER_HEIGHT = 150;
const COMPACT_BADGE_ROW_HEIGHT = 14;
const COMPACT_BADGE_ROW_GAP = 2;
const COMPACT_BADGE_TOP_PADDING = 3;
const MAX_COMPACT_BADGE_ROWS = 4;

const formatLastShowtime = (datetime: string) =>
  DateTime.fromISO(datetime).toFormat("ccc, LLL d");

const getCompactBadgeRowsForHeight = (height: number) => {
  const normalizedHeight = Math.max(0, height);
  const rows = Math.floor(
    (normalizedHeight + COMPACT_BADGE_ROW_GAP) /
      (COMPACT_BADGE_ROW_HEIGHT + COMPACT_BADGE_ROW_GAP)
  );
  return Math.max(1, Math.min(MAX_COMPACT_BADGE_ROWS, rows));
};

export default function MovieCard({ movie, onPress }: MovieCardProps) {
  // Read flow: props/state setup first, then helper handlers, then returned JSX.
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const [friendBadgeAreaHeight, setFriendBadgeAreaHeight] = useState(0);
  // Use backend totals when available so collapsed rows still show accurate "+N more" text.
  const showtimes = movie.showtimes || [];
  const totalShowtimes = movie.total_showtimes ?? showtimes.length;
  const shouldShowMoreLine =
    !!movie.last_showtime_datetime && totalShowtimes > MAX_SHOWTIMES;
  const showtimesLimit = shouldShowMoreLine ? MAX_SHOWTIMES - 1 : MAX_SHOWTIMES;
  const visibleShowtimes = showtimes.slice(0, showtimesLimit);
  const additionalShowtimes = Math.max(totalShowtimes - visibleShowtimes.length, 0);

  const friendsGoing = movie.friends_going || [];
  const friendsInterested = movie.friends_interested || [];
  const hasAudience = friendsGoing.length > 0 || friendsInterested.length > 0;
  const responsiveBadgeRows = useMemo(() => {
    if (!hasAudience) return undefined;
    return getCompactBadgeRowsForHeight(friendBadgeAreaHeight - COMPACT_BADGE_TOP_PADDING);
  }, [friendBadgeAreaHeight, hasAudience]);
  const cardStatusStyle =
    movie.going === "GOING"
      ? styles.movieCardGoing
      : movie.going === "INTERESTED"
        ? styles.movieCardInterested
        : undefined;
  const cardGlowStyle =
    movie.going === "GOING"
      ? styles.movieCardGlowGoing
      : movie.going === "INTERESTED"
        ? styles.movieCardGlowInterested
        : undefined;

  // Render/output using the state and derived values prepared above.
  return (
    <View style={[styles.movieCardGlow, cardGlowStyle]}>
      {/* Whole card is tappable so users can quickly jump to the full movie detail screen. */}
      <TouchableOpacity style={[styles.movieCard, cardStatusStyle]} onPress={() => onPress?.(movie)}>
        <Image source={{ uri: movie.poster_link ?? undefined }} style={styles.poster} />
        <View style={styles.movieInfo}>
          <ThemedText style={styles.movieTitle} numberOfLines={2} ellipsizeMode="tail">
            {movie.title}
          </ThemedText>
          <View style={styles.showtimesSection}>
            <View style={styles.showtimesBody}>
              {visibleShowtimes.length === 0 ? (
                <ThemedText style={styles.noShowtimesText}>No upcoming showtimes</ThemedText>
              ) : (
                <View style={styles.showtimeList}>
                  {visibleShowtimes.map((showtime) => (
                    <ShowtimeRow
                      key={showtime.id}
                      showtime={showtime}
                      variant="compact"
                    />
                  ))}
                </View>
              )}
              {movie.last_showtime_datetime && additionalShowtimes > 0 ? (
                <ThemedText style={styles.moreShowtimesText}>
                  +{additionalShowtimes} more (last on {formatLastShowtime(movie.last_showtime_datetime)})
                </ThemedText>
              ) : null}
            </View>
            {hasAudience ? (
              <View
                style={styles.friendBadgeArea}
                onLayout={(event) => {
                  const nextHeight = Math.floor(event.nativeEvent.layout.height);
                  if (nextHeight === friendBadgeAreaHeight) return;
                  setFriendBadgeAreaHeight(nextHeight);
                }}
              >
                <FriendBadges
                  friendsGoing={friendsGoing}
                  friendsInterested={friendsInterested}
                  variant="compact"
                  maxRows={responsiveBadgeRows}
                />
              </View>
            ) : null}
          </View>
        </View>
      </TouchableOpacity>
    </View>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) => {
  const glowStyles = createShowtimeStatusGlowStyles(colors);
  return StyleSheet.create({
    movieCardGlow: {
      marginBottom: 16,
      borderRadius: 12,
      backgroundColor: colors.cardBackground,
    },
    movieCardGlowGoing: glowStyles.going,
    movieCardGlowInterested: glowStyles.interested,
    movieCard: {
      flexDirection: "row",
      backgroundColor: colors.cardBackground,
      borderRadius: 12,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: colors.cardBorder,
      height: POSTER_HEIGHT,
    },
    movieCardGoing: {
      borderColor: colors.green.secondary,
      backgroundColor: colors.green.primary,
    },
    movieCardInterested: {
      borderColor: colors.orange.secondary,
      backgroundColor: colors.orange.primary,
    },
    poster: {
      width: 100,
      height: POSTER_HEIGHT,
      backgroundColor: colors.posterPlaceholder,
    },
    movieInfo: {
      flex: 1,
      paddingHorizontal: 10,
      paddingVertical: 8,
      justifyContent: "flex-start",
      minHeight: 0,
    },
    movieTitle: {
      fontSize: Platform.OS === "ios" ? 14 : 15,
      lineHeight: Platform.OS === "ios" ? 16 : 17,
      fontWeight: "700",
      color: colors.text,
      marginBottom: 2,
    },
    showtimesSection: {
      flex: 1,
      minHeight: 0,
    },
    showtimesBody: {
      flexShrink: 1,
      minHeight: 0,
    },
    showtimeList: {
      gap: 3,
    },
    noShowtimesText: {
      fontSize: 11,
      color: colors.textSecondary,
    },
    friendBadgeArea: {
      flex: 1,
      minHeight: 0,
      overflow: "hidden",
      paddingTop: COMPACT_BADGE_TOP_PADDING,
    },
    moreShowtimesText: {
      fontSize: 9,
      color: colors.textSecondary,
      marginTop: -2,
      marginBottom: -5,
    },
  });
};
