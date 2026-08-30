/**
 * Read-only seat map, opened by tapping "n/m seats available" — shows exactly
 * what's free/taken/friends/you right now, with nothing to edit: no row/seat
 * fields, no Save/Cancel, seats aren't tappable. A bottom sheet rather than
 * the plain full-screen `Modal` the editable picker (`SeatFloorPlan`) uses,
 * so it can be flicked away with a swipe like every other quick-glance sheet
 * in the app (e.g. `CinevilleCardModal`) — reusing `SeatRect`/`LegendItem`
 * from `SeatFloorPlan` keeps the colors identical between the two.
 */
import { useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { BottomSheetScrollView } from "@gorhom/bottom-sheet";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ScreenSide, SeatFloorPlanSeatPublic } from "shared";

import AppBottomSheet from "@/components/sheets/AppBottomSheet";
import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import { LegendItem, ScreenIndicator, SeatRect } from "@/components/showtimes/SeatFloorPlan";
import { layoutSeatFloorPlan } from "@/components/showtimes/seat-floor-plan-layout";

const FULL_HEIGHT_SNAP_POINTS = ["100%"];
const LEGEND_HEIGHT = 34;

type SeatFloorPlanPreviewProps = {
  visible: boolean;
  room: string | null;
  seats: SeatFloorPlanSeatPublic[] | null;
  /** Which end of `seats` the screen is at — a fact about the room, stored. */
  screenSide: ScreenSide;
  isLoading: boolean;
  cinemaName: string | null;
  movieTitle: string | null;
  dateLabel: string | null;
  timeRangeLabel: string | null;
  onClose: () => void;
};

export default function SeatFloorPlanPreview({
  visible,
  room,
  seats,
  screenSide,
  isLoading,
  cinemaName,
  movieTitle,
  dateLabel,
  timeRangeLabel,
  onClose,
}: SeatFloorPlanPreviewProps) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const [bodySize, setBodySize] = useState({ width: 0, height: 0 });

  const layout = useMemo(
    () => layoutSeatFloorPlan(seats ?? [], { availableWidth: bodySize.width, availableHeight: bodySize.height }),
    [seats, bodySize.width, bodySize.height]
  );

  const hasSeats = Boolean(seats && seats.length > 0);

  return (
    <AppBottomSheet
      visible={visible}
      onClose={onClose}
      title={movieTitle ?? "Seat map"}
      // One snap point, at the full height: like the barcode sheet, there is
      // no half-open state worth resting in — a swipe down only ever closes it.
      snapPoints={FULL_HEIGHT_SNAP_POINTS}
      // This can be opened from on top of the showtime sheet, so it must not
      // stay mounted behind it after a first close (see AppBottomSheet's own
      // doc comment on `dismissWhenClosed`).
      dismissWhenClosed
    >
      <BottomSheetScrollView
        contentContainerStyle={[styles.content, { paddingBottom: 24 + insets.bottom }]}
        scrollEnabled={false}
      >
        <ThemedText style={[styles.subtitle, { color: colors.textSecondary }]} numberOfLines={1}>
          {[cinemaName, room].filter(Boolean).join(" · ")}
        </ThemedText>
        {dateLabel || timeRangeLabel ? (
          <ThemedText style={[styles.subtitle, { color: colors.textSecondary }]} numberOfLines={1}>
            {[dateLabel, timeRangeLabel].filter(Boolean).join(" · ")}
          </ThemedText>
        ) : null}

        <View
          style={styles.body}
          onLayout={(event) => {
            const { width, height } = event.nativeEvent.layout;
            setBodySize({ width, height });
          }}
        >
          {isLoading ? (
            <ActivityIndicator color={colors.tint} />
          ) : hasSeats ? (
            <View style={{ width: layout.width }}>
              {screenSide === "top" ? (
                <ScreenIndicator width={layout.width} side="top" colors={colors} />
              ) : null}
              <View style={{ height: layout.height }}>
                {layout.seats.map((seat) => (
                  <SeatRect
                    key={`${seat.row_name}-${seat.seat_name}-${seat.x}-${seat.y}`}
                    seat={seat}
                    colors={colors}
                    isDraftSeat={seat.is_viewer_seat}
                    interactive={false}
                  />
                ))}
              </View>
              {screenSide === "bottom" ? (
                <ScreenIndicator width={layout.width} side="bottom" colors={colors} />
              ) : null}
            </View>
          ) : null}
        </View>

        {hasSeats && !isLoading ? (
          <View style={styles.legend}>
            <LegendItem label="Free" colors={colors} backgroundColor={colors.seatFree} />
            <LegendItem label="Taken" colors={colors} backgroundColor={colors.seatTaken} />
            <LegendItem label="Friend" colors={colors} backgroundColor={colors.seatFriend} />
            <LegendItem label="You" colors={colors} backgroundColor={colors.seatYou} />
          </View>
        ) : null}
      </BottomSheetScrollView>
    </AppBottomSheet>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingTop: 4,
    // paddingBottom set inline (24 + the bottom safe-area inset) so the
    // legend clears Android's gesture/nav bar instead of sitting under it.
    alignItems: "center",
    gap: 2,
  },
  subtitle: { fontSize: 12 },
  body: { flex: 1, width: "100%", alignItems: "center", justifyContent: "center" },
  legend: {
    height: LEGEND_HEIGHT,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 16,
  },
});
