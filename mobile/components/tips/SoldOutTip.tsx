/**
 * Feature tip: a screening the user is interested in sold out while the app
 * was closed, and seat availability notifications cannot reach them. Shows
 * the screening, so the news is concrete rather than a generic pitch.
 *
 * Seat availability is one preference covering nearly sold out, sold out and
 * returned tickets (see `LINKED_PREFERENCE_KEYS`), so turning it on here turns
 * on all three.
 *
 * Eligibility lives in `FeatureTipsHost`; this component renders the row.
 */
import { StyleSheet } from "react-native";
import type { ScreeningSummary } from "shared/client";

import NotificationEventTip from "@/components/tips/NotificationEventTip";
import TipScreeningRow from "@/components/tips/TipScreeningRow";
import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";

export default function SoldOutTip({ screening }: { screening: ScreeningSummary }) {
  const colors = useThemeColors();
  const styles = createStyles(colors);

  return (
    <NotificationEventTip
      tipId="sold-out"
      icon="event-busy"
      title="One of your screenings has sold out!"
      message="Turn on seat availability notifications to hear when a screening you're interested in is nearly sold out, so you can always grab a seat on time."
      preferenceKey="notify_on_seat_alert"
      enabledName="Seat availability notifications"
    >
      <TipScreeningRow screening={screening} />
      <ThemedText style={styles.note}>
        Seat availability isn't known for every cinema, so this doesn't work everywhere.
      </ThemedText>
    </NotificationEventTip>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    note: {
      fontSize: 12,
      lineHeight: 16,
      textAlign: "center",
      color: colors.textSecondary,
    },
  });
