/**
 * Mobile badge component: how busy a showtime is.
 *
 * Icon-only in a list row, where it has to compete with the time, the cinema
 * and the subtitles for a few pixels — the colour ramp carries the meaning at
 * that size, and the row's own tap already opens the sheet where the words are.
 * The `showLabel` variant is for the sheet itself.
 *
 * Reads from the prefetch cache and never fetches: a screenful of rows must not
 * become a screenful of requests. A row whose availability was never prefetched,
 * or that we have no usable reading for, renders nothing at all.
 */
import { StyleSheet, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useCachedShowtimeSeatAvailability } from "shared/hooks/useShowtimeSeatAvailability";

import { ThemedText } from "@/components/themed-text";
import { getSeatAvailabilityMeta } from "@/components/showtimes/seat-availability-level";
import { useThemeColors } from "@/hooks/use-theme-color";

type SeatAvailabilityBadgeProps = {
  showtimeId: number | null | undefined;
  variant?: "compact" | "default";
  showLabel?: boolean;
};

export default function SeatAvailabilityBadge({
  showtimeId,
  variant = "default",
  showLabel = false,
}: SeatAvailabilityBadgeProps) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const availability = useCachedShowtimeSeatAvailability(showtimeId ?? null);

  if (!availability?.level) return null;

  const meta = getSeatAvailabilityMeta(availability.level, colors);
  const isCompact = variant === "compact";

  return (
    <View
      style={[
        styles.container,
        isCompact ? styles.compactContainer : styles.defaultContainer,
        { borderColor: meta.color },
      ]}
      accessibilityRole="image"
      accessibilityLabel={meta.label}
    >
      <MaterialIcons name={meta.icon} size={isCompact ? 10 : 12} color={meta.color} />
      {showLabel ? (
        <ThemedText style={[styles.label, { color: meta.color }]} numberOfLines={1}>
          {meta.label}
        </ThemedText>
      ) : null}
    </View>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    container: {
      flexDirection: "row",
      alignItems: "center",
      gap: 3,
      borderWidth: 1,
      borderRadius: 3,
      backgroundColor: colors.pillBackground,
    },
    compactContainer: {
      minHeight: 14,
      paddingVertical: 1,
      paddingHorizontal: 3,
    },
    defaultContainer: {
      minHeight: 18,
      paddingVertical: 1,
      paddingHorizontal: 4,
    },
    label: {
      fontSize: 11,
      lineHeight: 12,
      includeFontPadding: false,
    },
  });
