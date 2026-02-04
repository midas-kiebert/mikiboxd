import { Image, StyleSheet, TouchableOpacity, View } from "react-native";
import type { ShowtimeLoggedIn } from "shared";

import { ThemedText } from "@/components/themed-text";
import ShowtimeRow from "@/components/showtimes/ShowtimeRow";
import { useThemeColors } from "@/hooks/use-theme-color";

type ShowtimeCardProps = {
  showtime: ShowtimeLoggedIn;
  onPress?: (showtime: ShowtimeLoggedIn) => void;
};

const POSTER_HEIGHT = 130;

export default function ShowtimeCard({ showtime, onPress }: ShowtimeCardProps) {
  const colors = useThemeColors();
  const styles = createStyles(colors);

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => onPress?.(showtime)}
      activeOpacity={0.8}
    >
      <Image
        source={{ uri: showtime.movie.poster_link ?? undefined }}
        style={styles.poster}
      />
      <View style={styles.info}>
        <ThemedText style={styles.title} numberOfLines={1} ellipsizeMode="tail">
          {showtime.movie.title}
        </ThemedText>
        <ShowtimeRow showtime={showtime} variant="compact" showFriends />
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
    poster: {
      width: 90,
      height: POSTER_HEIGHT,
      backgroundColor: colors.posterPlaceholder,
    },
    info: {
      flex: 1,
      paddingHorizontal: 10,
      paddingVertical: 8,
      gap: 6,
    },
    title: {
      fontSize: 16,
      fontWeight: "700",
      color: colors.text,
    },
  });
