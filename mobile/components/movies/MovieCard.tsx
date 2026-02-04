import {
  Image,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";

import { DateTime } from "luxon";
import type { MovieSummaryLoggedIn } from "shared";

import { ThemedText } from "@/components/themed-text";
import FriendBadges from "@/components/badges/FriendBadges";
import ShowtimeRow from "@/components/showtimes/ShowtimeRow";
import { useThemeColors } from "@/hooks/use-theme-color";

type MovieCardProps = {
  movie: MovieSummaryLoggedIn;
  onPress?: (movie: MovieSummaryLoggedIn) => void;
};

const MAX_SHOWTIMES = 5;
const POSTER_HEIGHT = 150;


const formatLastShowtime = (datetime: string) =>
  DateTime.fromISO(datetime).toFormat("ccc, LLL d");

export default function MovieCard({ movie, onPress }: MovieCardProps) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const showtimes = movie.showtimes || [];
  const totalShowtimes = movie.total_showtimes ?? showtimes.length;
  const shouldShowMoreLine =
    !!movie.last_showtime_datetime && totalShowtimes > MAX_SHOWTIMES;
  const showtimesLimit = shouldShowMoreLine ? MAX_SHOWTIMES - 1 : MAX_SHOWTIMES;
  const visibleShowtimes = showtimes.slice(0, showtimesLimit);
  const additionalShowtimes = Math.max(totalShowtimes - visibleShowtimes.length, 0);

  const friendsGoing = movie.friends_going || [];
  const friendsInterested = movie.friends_interested || [];
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

  return (
    <View style={[styles.movieCardGlow, cardGlowStyle]}>
      <TouchableOpacity style={[styles.movieCard, cardStatusStyle]} onPress={() => onPress?.(movie)}>
        <Image source={{ uri: movie.poster_link ?? undefined }} style={styles.poster} />
        <View style={styles.movieInfo}>
          <ThemedText style={styles.movieTitle} numberOfLines={1} ellipsizeMode="tail">
            {movie.title}
          </ThemedText>
          <View style={styles.showtimesSection}>
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
            <FriendBadges
              friendsGoing={friendsGoing}
              friendsInterested={friendsInterested}
              variant="compact"
              style={styles.friendBadges}
            />
          </View>
        </View>
      </TouchableOpacity>
    </View>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    movieCardGlow: {
      marginBottom: 16,
      borderRadius: 12,
      backgroundColor: colors.cardBackground,
    },
    movieCardGlowGoing: {
      shadowColor: colors.green.secondary,
      shadowOpacity: 0.6,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
      elevation: 8,
    },
    movieCardGlowInterested: {
      shadowColor: colors.orange.secondary,
      shadowOpacity: 0.6,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
      elevation: 8,
    },
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
      height: "100%",
    },
    movieTitle: {
      fontSize: 16,
      fontWeight: "bold",
      color: colors.text,
      marginBottom: 2,
    },
    showtimesSection: {
      flexShrink: 1,
    },
    showtimeList: {
      gap: 3,
    },
    noShowtimesText: {
      fontSize: 11,
      color: colors.textSecondary,
    },
    friendBadges: {
      marginTop: 2,
    },
    moreShowtimesText: {
      fontSize: 9,
      color: colors.textSecondary,
      marginTop: -2,
      marginBottom: -5,
    },
  });
