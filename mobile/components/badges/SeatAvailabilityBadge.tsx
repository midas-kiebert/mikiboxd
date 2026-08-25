/**
 * Mobile badge component: how busy a showtime is.
 *
 * Deliberately bare — just the icon and the raw seat count (`n/m`) in the
 * level's colour, no box or background. It has to sit quietly next to the
 * time/cinema/subtitles in a row without reading as another pill, and there
 * is nothing behind a tap here (that detail lives in the showtime sheet).
 * `iconOnly` drops the count entirely for spots too tight for it (a showtime
 * row inside a movie card).
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
  iconOnly?: boolean;
};

export default function SeatAvailabilityBadge({
  showtimeId,
  variant = "default",
  iconOnly = false,
}: SeatAvailabilityBadgeProps) {
  const colors = useThemeColors();
  const availability = useCachedShowtimeSeatAvailability(showtimeId ?? null);

  if (!availability?.level) return null;

  const meta = getSeatAvailabilityMeta(availability.level, colors);
  const isCompact = variant === "compact";
  const { seats_left: seatsLeft, seats_capacity: capacity } = availability;
  const countLabel =
    seatsLeft === null || seatsLeft === undefined
      ? null
      : capacity
        ? `${seatsLeft}/${capacity}`
        : `${seatsLeft}`;

  return (
    <View style={styles.container} accessibilityRole="image" accessibilityLabel={meta.label}>
      <MaterialIcons name={meta.icon} size={isCompact ? 10 : 12} color={meta.color} />
      {!iconOnly && countLabel ? (
        <ThemedText
          style={[styles.count, isCompact ? styles.countCompact : styles.countDefault, { color: meta.color }]}
          numberOfLines={1}
        >
          {countLabel}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  count: {
    includeFontPadding: false,
  },
  countCompact: {
    fontSize: 10,
    lineHeight: 12,
  },
  countDefault: {
    fontSize: 11,
    lineHeight: 13,
  },
});
