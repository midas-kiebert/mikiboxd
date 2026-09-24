/**
 * One screening inside a tip — poster, title, cinema and time — so a tip about
 * something that happened (an invite, a sell-out) shows the actual thing
 * rather than a generic pitch. Optional caption above the title (who sent an
 * invite) and optional press, to open the screening.
 */
import { Image } from "expo-image";
import { StyleSheet, TouchableOpacity, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import type { ScreeningSummary } from "shared/client";
import { DateTime } from "luxon";

import { ThemedText } from "@/components/themed-text";
import PosterPlaceholder from "@/components/ui/PosterPlaceholder";
import { useThemeColors } from "@/hooks/use-theme-color";

type TipScreeningRowProps = {
  screening: ScreeningSummary;
  caption?: string;
  onPress?: () => void;
};

export default function TipScreeningRow({ screening, caption, onPress }: TipScreeningRowProps) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const when = DateTime.fromISO(screening.datetime).toFormat("ccc d LLL · HH:mm");

  return (
    <TouchableOpacity
      style={styles.row}
      onPress={onPress}
      disabled={!onPress}
      activeOpacity={0.8}
      accessibilityRole={onPress ? "button" : undefined}
    >
      {screening.poster_link ? (
        <Image source={{ uri: screening.poster_link }} style={styles.poster} contentFit="cover" />
      ) : (
        <PosterPlaceholder style={styles.poster} glyphSize={18} />
      )}
      <View style={styles.text}>
        {caption ? (
          <ThemedText style={styles.caption} numberOfLines={1}>
            {caption}
          </ThemedText>
        ) : null}
        <ThemedText style={styles.title} numberOfLines={2}>
          {screening.movie_title}
        </ThemedText>
        <ThemedText style={styles.detail} numberOfLines={1}>
          {screening.cinema_name}
        </ThemedText>
        <ThemedText style={styles.detail} numberOfLines={1}>
          {when}
        </ThemedText>
      </View>
      {onPress ? (
        <MaterialIcons name="chevron-right" size={20} color={colors.textSecondary} />
      ) : null}
    </TouchableOpacity>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      alignSelf: "stretch",
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBackground,
      padding: 10,
    },
    poster: {
      width: 40,
      height: 60,
      borderRadius: 6,
      overflow: "hidden",
      backgroundColor: colors.surfaceMuted,
    },
    text: {
      flex: 1,
      gap: 1,
    },
    caption: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "700",
      color: colors.tint,
    },
    title: {
      fontSize: 14,
      lineHeight: 18,
      fontWeight: "700",
      color: colors.text,
    },
    detail: {
      fontSize: 13,
      lineHeight: 17,
      color: colors.textSecondary,
    },
  });
